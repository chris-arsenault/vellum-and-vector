/**
 * The grade a laden cart or pack train holds on a made way. Effort grows with the square of
 * the grade over it, so a direct climb up a steep slope costs more than a longer oblique one:
 * ways keep to valleys, cross at passes and zigzag up the slopes they must climb.
 */
export const rulingGrade = 0.08;
/**
 * Extra cost of crossing ground floods soak, at full floodplain: carts mire on it and it is
 * under water in the wet season, so ways keep to the terrace edge beside a river and cross
 * its floor where it is shortest.
 */
export const wetGroundCost = 3;
