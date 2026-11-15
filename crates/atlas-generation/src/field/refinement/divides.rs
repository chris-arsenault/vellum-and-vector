use crate::lattice::TriangularLattice;
use std::io;
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Drainage {
    pub receiver: Vec<i32>,
    pub order: Vec<usize>,
}
impl crate::field::Field {
    pub fn regional_drainage(&self) -> io::Result<Drainage> {
        let targets = self.water().routing.targets;
        let order = crate::flow_graph::target_order(&mut self.coverage.borrow_mut(), &targets)?;
        Ok(Drainage {
            receiver: (0..targets.len())
                .map(|cell| targets.get(cell))
                .collect::<io::Result<_>>()?,
            order: (0..order.len())
                .rev()
                .map(|at| order.get(at).map(|cell| cell as usize))
                .collect::<io::Result<_>>()?,
        })
    }
    pub fn regional_divides(&self, drainage: &Drainage) -> io::Result<()> {
        let owner = self.water.borrow();
        let water = owner.read_only();
        let rivers = owner.river_reader();
        let terrain = crate::water::network::RiverTerrain {
            mesh: &self.mesh,
            water_kind: &water.column.kind,
            targets: &water.routing.targets,
        };
        let mut channel = Vec::with_capacity(self.mesh.len());
        let mut successor = Vec::with_capacity(self.mesh.len());
        for cell in 0..self.mesh.len() {
            channel.push(u8::from(
                rivers.order_at(cell, water.column.kind.get(cell)?) > 0,
            ));
            successor.push(
                rivers
                    .successor(cell, None, &terrain)?
                    .map_or(-1, |next| next as i32),
            );
        }
        let values = divides(
            &self.mesh,
            &drainage.receiver,
            &drainage.order,
            &channel,
            &successor,
        )?;
        let mut ridge = self
            .shared
            .derive_float(crate::field::shared::FloatField::RidgeInfluence);
        for (cell, value) in values.into_iter().enumerate() {
            ridge.set(cell, f32::from(value))?;
        }
        Ok(())
    }
}
pub fn segment_labels(
    receiver: &[i32],
    order: &[usize],
    channel: &[u8],
    successor: &[i32],
) -> io::Result<Vec<i32>> {
    let mut next = vec![-1; receiver.len()];
    let mut joins = vec![0u8; receiver.len()];
    for cell in 0..next.len() {
        let target = successor[cell];
        if channel[cell] != 0 && target >= 0 && channel[target as usize] != 0 {
            next[cell] = target;
            joins[target as usize] = (joins[target as usize] + 1).min(2);
        }
    }
    let mut labels = vec![-1; receiver.len()];
    let mut stack = Vec::new();
    for cell in 0..next.len() {
        if channel[cell] != 0 && labels[cell] < 0 {
            label_path(cell, &next, &joins, &mut labels, &mut stack)?;
        }
    }
    for &cell in order {
        if channel[cell] == 0 {
            labels[cell] = if receiver[cell] >= 0 {
                labels[receiver[cell] as usize]
            } else {
                cell as i32
            };
        }
    }
    Ok(labels)
}
fn label_path(
    cell: usize,
    next: &[i32],
    joins: &[u8],
    label: &mut [i32],
    stack: &mut Vec<usize>,
) -> io::Result<()> {
    let mut end = cell;
    while label[end] == -1 {
        label[end] = -2;
        stack.push(end);
        let target = next[end];
        if target < 0 || joins[target as usize] >= 2 {
            label[end] = end as i32;
            break;
        }
        end = target as usize;
    }
    if label[end] == -2 {
        return Err(io::Error::other(
            "Retained channel segments contain a cycle",
        ));
    }
    while let Some(at) = stack.pop() {
        let target = next[at];
        label[at] = if target >= 0 && joins[target as usize] < 2 {
            label[target as usize]
        } else {
            at as i32
        };
    }
    Ok(())
}
pub fn divides(
    mesh: &TriangularLattice,
    receiver: &[i32],
    order: &[usize],
    channel: &[u8],
    successor: &[i32],
) -> io::Result<Vec<u8>> {
    let labels = segment_labels(receiver, order, channel, successor)?;
    let mut divide = vec![0; mesh.len()];
    for &cell in order {
        if channel[cell] != 0 {
            continue;
        }
        let mut other = false;
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if channel[next] != 0 {
                other = false;
                break;
            }
            if labels[next] >= 0 && labels[next] != labels[cell] {
                other = true;
            }
        }
        divide[cell] = u8::from(other);
    }
    Ok(divide)
}
