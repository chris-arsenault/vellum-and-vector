import { regionalSpan } from "../lattice";
import { scaleAround } from "../network";
import { placesEnabled } from "../places";
import { drawChannelsToSeats, knownSeats, seatCaps, settleSeats } from "../seats";
import { registerCause } from "./registry";

/** A river seat draws a channel to itself: the ground around it is cheaper to run through. */
const seatCorridor = 0.5;

/**
 * A known settlement's seat is a cause in every round (spec 6.3): its footprint holds the
 * relief's gradient down so the ground it stands on is usable; a river seat draws the network
 * to it and stands on a channel; after each round's water it settles on the developed ground
 * when this run develops both the ground and the places. Seats are read from their captured
 * position every run, so a seat an earlier refinement moved is re-sited from the same evidence.
 */
registerCause({
  kind: "settlement",
  read(state, evidence) {
    evidence.seats.push(...knownSeats(state));
  },
  influence(state, cost) {
    const span = regionalSpan(state);
    for (const seat of state.regional.evidence!.seats)
      if (seat.situation === "river") scaleAround(state, cost, seat.cell, 2 * span, seatCorridor);
  },
  support: drawChannelsToSeats,
  caps: seatCaps,
  respond(state) {
    const domains = state.regional.input.domains;
    if (domains.includes("physical") && placesEnabled(domains)) settleSeats(state);
  },
});
