export type CuratedProviderGroupId =
  | "google"
  | "anthropic"
  | "openai"
  | "deepseek"
  | "z-ai"
  | "qwen"
  | "meta"
  | "mistral"
  | "moonshot-ai"
  | "minimax"
  | "xai";

type ModelForGrouping = {
  id: string;
  architecture?: {
    tokenizer?: string | null;
    instructType?: string | null;
  } | null;
};

type CuratedProviderGroup = {
  id: CuratedProviderGroupId;
  label: string;
  organizationAliases: readonly string[];
  familyPatterns: readonly RegExp[];
};

// This order is also the order used by the model-picker navigation.
export const curatedProviderGroups: readonly CuratedProviderGroup[] = [
  {
    id: "google",
    label: "Google",
    organizationAliases: ["google", "google-deepmind", "deepmind"],
    familyPatterns: [/(?:^|[\/_.:-])(?:gemini|gemma|paligemma)(?:\d|$|[\/_.:-])/],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    organizationAliases: ["anthropic"],
    familyPatterns: [/(?:^|[\/_.:-])claude(?:\d|$|[\/_.:-])/],
  },
  {
    id: "openai",
    label: "OpenAI",
    organizationAliases: ["openai"],
    familyPatterns: [/(?:^|[\/_.:-])(?:chatgpt|gpt|codex)(?:\d|$|[\/_.:-])/, /(?:^|[\/_.:-])o[134](?:$|[\/_.:-])/],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    organizationAliases: ["deepseek", "deepseek-ai"],
    familyPatterns: [/(?:^|[\/_.:-])deepseek(?:$|[\/_.:-])/],
  },
  {
    id: "z-ai",
    label: "Z.AI",
    organizationAliases: ["z-ai", "zai", "thudm"],
    familyPatterns: [/(?:^|[\/_.:-])glm(?:\d|$|[\/_.:-])/],
  },
  {
    id: "qwen",
    label: "Qwen",
    organizationAliases: ["qwen", "alibaba", "alibaba-cloud", "alibabacloud"],
    familyPatterns: [/(?:^|[\/_.:-])(?:qwen|qwq)(?:\d|$|[\/_.:-])/],
  },
  {
    id: "meta",
    label: "Meta",
    organizationAliases: ["meta", "meta-llama", "facebook"],
    familyPatterns: [/(?:^|[\/_.:-])(?:llama|codellama)(?:\d|$|[\/_.:-])/],
  },
  {
    id: "mistral",
    label: "Mistral",
    organizationAliases: ["mistral", "mistral-ai", "mistralai"],
    familyPatterns: [/(?:^|[\/_.:-])(?:mistral|mixtral|ministral|codestral|pixtral)(?:\d|$|[\/_.:-])/],
  },
  {
    id: "moonshot-ai",
    label: "Moonshot AI",
    organizationAliases: ["moonshot", "moonshot-ai", "moonshotai"],
    familyPatterns: [/(?:^|[\/_.:-])kimi(?:\d|$|[\/_.:-])/],
  },
  {
    id: "minimax",
    label: "MiniMax",
    organizationAliases: ["minimax", "minimax-ai", "minimaxai"],
    familyPatterns: [/(?:^|[\/_.:-])minimax(?:$|[\/_.:-])/],
  },
  {
    id: "xai",
    label: "xAI",
    organizationAliases: ["x-ai", "xai"],
    familyPatterns: [/(?:^|[\/_.:-])grok(?:\d|$|[\/_.:-])/],
  },
];

export function curatedProviderGroupForModel(model: ModelForGrouping): CuratedProviderGroup | null {
  const normalizedId = model.id.trim().toLowerCase().replace(/^~+/, "");
  const organization = normalizedId.includes("/") ? normalizedId.split("/", 1)[0] : "";

  // A catalog organization is more authoritative than a family word in the model name.
  const organizationMatch = curatedProviderGroups.find(group =>
    group.organizationAliases.includes(organization)
  );
  if (organizationMatch) return organizationMatch;

  const familyMetadata = [
    normalizedId,
    model.architecture?.tokenizer?.trim().toLowerCase() ?? "",
    model.architecture?.instructType?.trim().toLowerCase() ?? "",
  ].join("/");

  return curatedProviderGroups.find(group =>
    group.familyPatterns.some(pattern => pattern.test(familyMetadata))
  ) ?? null;
}
