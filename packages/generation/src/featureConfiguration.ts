import { z } from "zod";
import { ecologyEpochSchema, requireThat, type ParameterValues } from "@atlas/domain";
import type { GenerationFeature } from "./features";
import { terrainHistorySchema, terrainEpochs, landscapeEpoch } from "./cartographicHistory";
import {
  generationEpochSchema,
  generationSettingsSchema,
  humanEraSchema,
  type GenerationSettings,
} from "./generationSettings";

const physicalEpoch = generationEpochSchema.omit({ ecology: true, magicActivity: true });
const clockSchema = z
  .object({
    epochs: z.array(physicalEpoch).min(1),
    history: terrainHistorySchema.nullable().optional(),
  })
  .strict();
const ecologySchema = z
  .object({
    epochs: z.record(z.string(), ecologyEpochSchema.strict()),
    landscape: ecologyEpochSchema.strict().nullable().optional(),
    glaciated: z.boolean().default(false),
  })
  .strict();
const magicSchema = z
  .object({
    magicSystems: generationSettingsSchema.shape.magicSystems,
    activity: z.record(z.string(), z.record(z.string(), z.number().finite().nonnegative())),
  })
  .strict();
const culturalSchema = z
  .object({
    eras: z.array(
      humanEraSchema.extend({
        physicalEpoch: z.string().nullable().optional(),
        politicalCapacity: z.number().finite().nonnegative().optional(),
      })
    ),
  })
  .strict();
const legacy = (settings: ParameterValues) => generationSettingsSchema.parse(settings);
type Configuration = Pick<
  GenerationFeature,
  "configuration" | "configurationFromLegacy" | "configurationBinding" | "configurationPresentation"
>;

function physicalOnly(epoch: GenerationSettings["epochs"][number]) {
  const { ecology: _ecology, magicActivity: _magic, ...physical } = epoch;
  void _ecology;
  void _magic;
  return physical;
}
function projectClock(configuration: ParameterValues, settings: GenerationSettings) {
  const bound = clockSchema.parse(configuration);
  return {
    epochs: bound.epochs.map((epoch) => ({
      ...epoch,
      ecology: settings.epochs.find((item) => item.id === epoch.id)?.ecology ?? {},
      magicActivity: settings.epochs.find((item) => item.id === epoch.id)?.magicActivity ?? {},
    })),
  };
}
function checkEpochs(ids: string[], settings: GenerationSettings) {
  const known = new Set(settings.epochs.map((epoch) => epoch.id));
  for (const id of ids)
    requireThat(known.has(id), "feature_epoch", `Bind settings to an existing epoch: ${id}.`);
}

export const clockConfiguration: Configuration = {
  configuration: clockSchema,
  configurationFromLegacy: (settings) => ({ epochs: legacy(settings).epochs.map(physicalOnly) }),
  configurationPresentation: {
    applicability: "initial",
    epochs: { path: "epochs", shape: "clock" },
  },
  configurationBinding: {
    fields: ["epochs"],
    prepare: (configuration, settings) =>
      projectClock({ epochs: settings.epochs.map(physicalOnly), ...configuration }, settings),
    bind(configuration, settings, parameters) {
      const bound = clockSchema.parse(configuration);
      const projected = projectClock(configuration, settings);
      return {
        epochs: bound.history
          ? terrainEpochs(projected.epochs, bound.history, parameters.temperature)
          : projected.epochs,
      };
    },
  },
};
export const ecologyConfiguration: Configuration = {
  configuration: ecologySchema,
  configurationFromLegacy: (settings) => ({
    epochs: Object.fromEntries(
      legacy(settings).epochs.map((epoch) => [
        epoch.id,
        ecologyEpochSchema.parse(epoch.ecology ?? {}),
      ])
    ),
  }),
  configurationPresentation: {
    applicability: "initial",
    epochs: { path: "epochs", shape: "record", extension: "ecology" },
  },
  configurationBinding: {
    fields: [],
    epochFields: ["ecology"],
    bind(configuration, settings) {
      const bound = ecologySchema.parse(configuration);
      checkEpochs(Object.keys(bound.epochs), settings);
      return {
        epochs: settings.epochs.map((epoch, index) => ({
          ...epoch,
          ecology: landscapeEpoch(
            ecologyEpochSchema.parse(bound.epochs[epoch.id] ?? epoch.ecology ?? {}),
            bound.landscape ?? undefined,
            bound.glaciated,
            index,
            settings.epochs.length
          ),
        })),
      };
    },
  },
};
export const magicConfiguration: Configuration = {
  configuration: magicSchema,
  configurationFromLegacy: (settings) => ({
    magicSystems: legacy(settings).magicSystems,
    activity: Object.fromEntries(
      legacy(settings).epochs.map((epoch) => [epoch.id, epoch.magicActivity ?? {}])
    ),
  }),
  configurationPresentation: {
    applicability: "initial",
    epochs: { path: "activity", shape: "record", extension: "magicActivity" },
  },
  configurationBinding: {
    fields: ["magicSystems"],
    epochFields: ["magicActivity"],
    bind(configuration, settings) {
      const bound = magicSchema.parse(configuration);
      checkEpochs(Object.keys(bound.activity), settings);
      const systems = new Set(bound.magicSystems.map((system) => system.id));
      for (const activity of Object.values(bound.activity))
        for (const id of Object.keys(activity))
          requireThat(
            systems.has(id),
            "magic_activity",
            `Bind activity to an existing magical system: ${id}.`
          );
      return {
        magicSystems: bound.magicSystems,
        epochs: settings.epochs.map((epoch) => ({
          ...epoch,
          magicActivity: bound.activity[epoch.id] ?? {},
        })),
      };
    },
  },
};
export const culturalConfiguration: Configuration = {
  configuration: culturalSchema,
  configurationFromLegacy: (settings) => ({
    eras: legacy(settings).humanEras.map((era) => ({ ...era })),
  }),
  configurationPresentation: { applicability: "initial" },
  configurationBinding: {
    fields: ["humanEras"],
    bind(configuration, settings) {
      const bound = culturalSchema.parse(configuration);
      return {
        humanEras: bound.eras.map((era) => ({
          ...era,
          physicalEpoch:
            era.physicalEpoch !== undefined
              ? era.physicalEpoch
              : (settings.humanEras.find((item) => item.id === era.id)?.physicalEpoch ?? null),
          politicalCapacity:
            era.politicalCapacity ??
            settings.humanEras.find((item) => item.id === era.id)?.politicalCapacity ??
            1,
        })),
      };
    },
  },
};
