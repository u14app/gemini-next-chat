export type SkillDataLocale = "en" | "zh-CN" | "ja";

export interface TextSkillRisk {
  level: "low" | "medium" | "high" | string;
  textOnly: boolean;
  scriptRequired: boolean;
  externalToolRequired: boolean;
  networkRequired: boolean;
  reviewRequiredForHighStakes: boolean;
}

export interface TextSkillActivation {
  embeddingText: string;
  useWhen: string[];
  avoidWhen: string[];
  exampleQueries: string[];
}

export type SkillParameterInput = "text" | "textarea" | "select";

export interface SkillParameterOption {
  value: string;
  label: string;
}

export interface SkillParameterDefinition {
  key: string;
  label: string;
  description?: string;
  input: SkillParameterInput;
  required?: boolean;
  defaultValue?: string;
  options?: SkillParameterOption[];
  maxLength: number;
}

export interface SkillRuntimeV2 {
  kind: "declarative_text";
  supportsScripts: false;
  acceptsPlaintextSecrets: false;
}

export interface SkillOutputContractV2 {
  format: string;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface SkillEvalCaseV2 {
  id: string;
  input: string;
  expected?: string[];
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  audience: string;
  language: string;
  outputFormat: string;
  risk: TextSkillRisk;
  activation: TextSkillActivation;
  parameters?: SkillParameterDefinition[];
  file?: string;
  builtIn?: boolean;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
  version?: string;
  publisher?: string;
  source?: string;
  contentHash?: string;
  locales?: string[];
  runtime?: SkillRuntimeV2;
  requiredCapabilities?: string[];
  /** A Skill may only narrow the caller's already-authorized Tool set. */
  allowedTools?: string[];
  outputContract?: SkillOutputContractV2;
  evalCases?: SkillEvalCaseV2[];
}

export interface TextSkill extends SkillCatalogEntry {
  content: string;
}

export interface SkillDatasetRuntime {
  environment: string;
  storage: string;
  executionModel: string;
  supportsScripts: boolean;
  supportsExternalTools: boolean;
  supportsNetwork: boolean;
}

export interface SkillCatalog {
  schemaVersion: string;
  generatedAt: string;
  locale: SkillDataLocale;
  datasetName: string;
  description: string;
  intendedRuntime: SkillDatasetRuntime;
  globalPolicy: Record<string, unknown>;
  sourceBasis?: unknown[];
  skillCount: number;
  categories: string[];
  skills: SkillCatalogEntry[];
}

export interface SkillCandidate {
  skill: SkillCatalogEntry;
  score: number;
}

export type SkillInvocationMode = "manual" | "auto";

export interface SelectedSkill {
  skill: SkillCatalogEntry;
  mode: SkillInvocationMode;
}

export interface AppliedSkill {
  skill: TextSkill;
  mode: SkillInvocationMode;
  parameters?: Record<string, string>;
  bundleId?: string;
}

export interface AppliedSkillInvocation {
  id: string;
  title: string;
  description?: string;
  category: string;
  mode: SkillInvocationMode;
  schemaVersion?: 2;
  definitionHash?: string;
  order?: number;
  parameters?: Record<string, string>;
  bundleId?: string;
}

export type SkillParameterBinding =
  { type: "literal"; value: string } | { type: "bundle"; parameterKey: string };

export interface SkillBundleStep {
  id: string;
  skillId: string;
  bindings: Record<string, SkillParameterBinding>;
}

export interface SkillBundle {
  id: string;
  title: string;
  description: string;
  parameters: SkillParameterDefinition[];
  steps: SkillBundleStep[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillSelectionResult {
  selectedSkillIds: string[];
  reason?: string;
}
