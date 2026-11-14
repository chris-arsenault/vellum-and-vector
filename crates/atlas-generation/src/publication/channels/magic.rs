use super::{binding, Binding, Inputs, Quantity};
use crate::magic::{
    channels::{Channel, Quantity as MagicQuantity},
    regions::independent_interaction,
};

pub(super) fn bindings(input: &Inputs<'_>, into: &mut Vec<Binding>) {
    let configured = input.enabled("magic.configured");
    into.push(binding(
        "magic:strain",
        "ratio",
        "magic",
        configured,
        &["magic.configured"],
    ));
    for (name, unit) in [
        ("Tenure", "person-year"),
        ("WalkedRoute", "traveller-year"),
        ("KeptLine", "year"),
        ("MassDeath", "people"),
    ] {
        into.push(Binding {
            quantity: Quantity::Extensive,
            ..binding(name, unit, "magic", configured, &["magic.configured"])
        });
    }
    for system in input.systems {
        system_bindings(system, configured, into);
    }
    for meeting in input.confluences {
        let active = configured
            && meeting.enabled
            && meeting
                .systems
                .iter()
                .all(|id| input.systems.iter().any(|s| s.id == *id && s.enabled));
        for (suffix, unit) in [("members", "category"), ("coverage", "ratio")] {
            into.push(binding(
                format!("magic:confluence:{}:{suffix}", meeting.id),
                unit,
                "magic",
                active,
                &["magic.configured"],
            ));
        }
    }
    for source in input
        .sources
        .iter()
        .filter(|source| source.system_id.is_none())
    {
        let thermal = ["heat", "cold"].contains(&source.effect.as_str());
        let key = format!("magic:{}", source.id);
        let publish = input.enabled("magic.local");
        into.push(binding(
            &key,
            if thermal { "celsius" } else { "ratio" },
            "magic",
            publish,
            &["magic.local"],
        ));
        if thermal {
            for suffix in ["forcing", "stored"] {
                into.push(binding(
                    format!("{key}:{suffix}"),
                    "celsius",
                    "magic",
                    publish,
                    &["magic.local"],
                ));
            }
        }
    }
}

fn system_bindings(
    system: &crate::magic::configuration::System,
    configured: bool,
    into: &mut Vec<Binding>,
) {
    let publish = configured && system.enabled;
    let key = |suffix: &str| format!("magic:{}:{suffix}", system.id);
    for origin in &system.origins {
        into.push(binding(
            key(&format!("origin:{}:source", origin.id)),
            "relative-intensity",
            "magic",
            publish,
            &["magic.configured"],
        ));
        let stocks = if origin.stocks.is_empty() {
            vec!["held"]
        } else {
            origin
                .stocks
                .iter()
                .map(|stock| stock.id.as_str())
                .collect()
        };
        for stock in stocks {
            into.push(Binding {
                quantity: Quantity::Extensive,
                ..binding(
                    key(&format!("stock:{}/{stock}", origin.id)),
                    "intensity-square-metre",
                    "magic",
                    publish,
                    &["magic.configured"],
                )
            });
        }
    }
    for channel in Channel::ALL {
        let definition = channel.definition();
        if definition.publish {
            let quantity = match definition.quantity {
                MagicQuantity::Intensive => Quantity::Intensive,
                MagicQuantity::Extensive => Quantity::Extensive,
                MagicQuantity::Category => Quantity::Category,
            };
            into.push(Binding {
                quantity,
                ..binding(
                    key(definition.name),
                    definition.unit,
                    "magic",
                    publish,
                    &["magic.configured"],
                )
            });
        }
    }
    into.push(binding(
        key("coverage"),
        "ratio",
        "magic",
        publish,
        &["magic.configured"],
    ));
    for rule in &system.features {
        let active = configured && (system.enabled || independent_interaction(rule, &system.id));
        into.push(binding(
            key(&format!("feature:{}", rule.id)),
            "category",
            "magic",
            active,
            &["magic.configured"],
        ));
        into.push(binding(
            key(&format!("coverage:{}", rule.id)),
            "ratio",
            "magic",
            active,
            &["magic.configured"],
        ));
    }
}
