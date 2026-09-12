import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Render model-authored Markdown using the chat's existing sanitization policy. */
export function renderMessageMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text || '') as string);
}
