/**
 * Shared phonotactic name generation pipeline
 *
 * This module consolidates the name generation logic that was previously
 * duplicated across generator.ts, api-server.ts, and profile-executor.ts.
 *
 * The pipeline: phonology → morphology → style
 *
 * CRITICAL: Syllable boundaries must be tracked through all phases for
 * correct apostrophe/hyphen placement in the style phase.
 */

import type { NamingDomain } from "./types/domain.js";
import { generateWordWithDebug } from "./phonology.js";
import { applyMorphologyBest, canApplyMorphology } from "./morphology.js";
import { applyStyle } from "./style.js";

export interface PipelineResult {
  /** Final styled name */
  name: string;
  /** Debug info about the generation */
  debug: {
    /** Raw word from phonology */
    rawWord: string;
    /** Syllables from phonology */
    syllables: string[];
    /** Templates used */
    templates: string[];
    /** Word after morphology */
    morphedWord: string;
    /** Syllables after morphology (includes affixes) */
    morphedSyllables: string[];
    /** Morphology structure used (e.g., "prefix-root-suffix") */
    morphologyStructure: string;
    /** Morphology parts breakdown */
    morphologyParts: string[];
    /** Style transforms applied */
    styleTransforms: string[];
  };
}

/**
 * Execute the full phonotactic name generation pipeline
 *
 * This is the single source of truth for generating names from a domain.
 * All callers should use this function rather than calling phonology,
 * morphology, and style separately.
 *
 * @param rng - Random number generator function
 * @param domain - The naming domain configuration
 * @param options - Optional settings
 * @returns Generated name with debug information
 */
export function executePhonotacticPipeline(
  rng: () => number,
  domain: NamingDomain,
  options: {
    /** Number of morphology candidates to generate (default: 3) */
    morphologyCandidates: number;
    /** Maximum name length for morphology scoring (default: 20) */
    maxMorphologyLength: number;
  } = { morphologyCandidates: 3, maxMorphologyLength: 20 }
): PipelineResult {
  const { morphologyCandidates = 3, maxMorphologyLength = 20 } = options;

  // Phase 1: Generate phonological base with syllables
  const { word, syllables, templates } = generateWordWithDebug(rng, domain.phonology);

  // Phase 2: Apply morphology (if configured), tracking syllables through
  let morphedWord = word;
  let morphedSyllables = syllables;
  let morphologyStructure = "root";
  let morphologyParts = [`root:${word}`];

  if (canApplyMorphology(domain.morphology)) {
    const morphed = applyMorphologyBest(
      rng,
      word,
      domain.morphology,
      morphologyCandidates,
      maxMorphologyLength,
      syllables
    );
    morphedWord = morphed.result;
    morphedSyllables = morphed.syllables;
    morphologyStructure = morphed.structure;
    morphologyParts = morphed.parts;
  }

  // Phase 3: Apply style transforms with correct syllable boundaries
  const { result: name, transforms } = applyStyle(rng, morphedWord, domain.style, morphedSyllables);

  return {
    name,
    debug: {
      rawWord: word,
      syllables,
      templates,
      morphedWord,
      morphedSyllables,
      morphologyStructure,
      morphologyParts,
      styleTransforms: transforms,
    },
  };
}

/**
 * Simple wrapper that returns just the name string
 * For callers that don't need debug info
 */
export function generatePhonotacticName(rng: () => number, domain: NamingDomain): string {
  return executePhonotacticPipeline(rng, domain).name;
}
