// src/lib/utils/promptBuilder.ts

export type ModelType = 'claude' | 'gpt' | 'ollama' | 'openrouter';

export interface PromptBuilderOptions {
  charName: string;
  desc?: string | null;
  personality?: string | null;
  scenario?: string | null;
  example?: string | null;
  lang: string;
  userName?: string;
  modelType?: ModelType;
}

export function buildSystemPrompt({
  charName,
  desc,
  personality,
  scenario,
  example,
  lang,
  userName = 'User',
  modelType = 'ollama' // Default
}: PromptBuilderOptions): string {
  
  // 1. Core Instructions
  let prompt = `You are ${charName}. Reply in ${lang}.`;
  
  // 2. Optional: User introduction
  if (userName && userName !== 'User') {
    prompt += ` You are talking to ${userName}.`;
  }
  
  // 3. Character sections (model-aware formatting)
  const sections = [];
  
  if (desc?.trim()) sections.push({ label: 'description', content: desc.trim() });
  if (personality?.trim()) sections.push({ label: 'personality', content: personality.trim() });
  if (scenario?.trim()) sections.push({ label: 'scenario', content: scenario.trim() });
  if (example?.trim()) sections.push({ label: 'example_dialog', content: example.trim() });
  
  // Format based on model type
  for (const section of sections) {
    prompt += '\n\n' + formatSection(section.label, section.content, modelType);
  }
  
  return prompt;
}

function formatSection(label: string, content: string, modelType: ModelType): string {
  switch (modelType) {
    case 'claude':
      return `<${label}>\n${content}\n</${label}>`;
    
    case 'gpt':
      return `**${capitalize(label)}:**\n${content}`;
    
    case 'ollama':
    case 'openrouter':
    default:
      // Minimalist format for local models
      return `### ${capitalize(label)}\n${content}`;
  }
}

function capitalize(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}