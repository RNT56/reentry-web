export const WRITING_STYLE =
  "Direct, analytical prose. One main idea and one central analysis scenario per article. Keep competing theses clearly separate and suggest separate linked articles where needed. Distinguish facts, assumptions and judgments. No em dashes. Use clear headings and well-developed paragraphs.";
export const writingPresets = Object.freeze({
  article: {
    label: "Full article",
    words: 1600,
    format: "text",
    prompt:
      "Write a complete journal article about the primary asset, built around one central thesis. Use the attached asset context and draft as your starting point. Develop the mechanism, supporting evidence, explicit assumptions, one conditional scenario, its horizon and invalidation, and the evidence to watch next. Use related assets only where they help explain this thesis. Keep competing theses separate. Cite supplied source URLs for factual claims and clearly identify missing or outdated evidence.",
  },
  paragraph: {
    label: "Paragraph",
    words: 150,
    format: "text",
    prompt:
      "Write one developed paragraph about the primary asset that advances the central idea in this draft. Use the selected passage when present and the attached asset context where relevant. Keep facts, assumptions and personal judgments distinct. Cite supplied evidence for factual claims and avoid repeating what the draft already explains.",
  },
  theory: {
    label: "Theory",
    words: 300,
    format: "text",
    prompt:
      "Formulate one theory about the primary asset. Explain its causal mechanism, the evidence supporting it, the assumptions it depends on and a falsifiable prediction. Use the attached asset context, distinguish interpretation from verified evidence, and state what information is still missing.",
  },
  thesis: {
    label: "Thesis",
    words: 300,
    format: "text",
    prompt:
      "Formulate one clear investment thesis for the primary asset using the attached asset context. Explain the causal chain, why it matters, the evidence needed for confirmation, the time horizon and what would invalidate it. Keep competing theses separate and do not treat prior AI analysis as established fact.",
  },
  assumption: {
    label: "Assumption",
    words: 250,
    format: "text",
    prompt:
      "State one explicit assumption underlying this article's central thesis. Explain why it matters, what supports it in the attached asset context, how it can be tested and what would change if it proves wrong. Keep the assumption clearly separate from facts.",
  },
  scenario: {
    label: "Scenario",
    words: 350,
    format: "text",
    prompt:
      "Develop one conditional scenario for the primary asset: trigger, transmission mechanism, outlook, horizon, confirmation evidence and invalidation. Use the attached asset context and the draft. Include numerical ranges only when supplied evidence supports them, preserving currency and dates. Keep alternative scenarios separate and do not apply the primary asset's targets to related assets.",
  },
  rewrite: {
    label: "Rewrite",
    words: 300,
    format: "text",
    prompt:
      "Revise the selected passage, or the draft if no passage is selected, for clarity and flow. Preserve the author's central idea, meaning, qualifications and numeric values. Use the attached asset context to identify unsupported or inconsistent claims, and flag uncertainty instead of silently inventing corrections.",
  },
  grammar: {
    label: "Grammar check",
    words: 300,
    format: "review",
    prompt:
      "Check this draft for grammar, spelling, punctuation and clarity while preserving the author's voice and meaning. Return specific proposed corrections tied to exact passages, with a short explanation. Do not rewrite the whole article. Use the attached asset context only to check names and terminology, not to introduce new claims.",
  },
  structure: {
    label: "Structure check",
    words: 300,
    format: "review",
    prompt:
      "Review this draft's central thesis, logical progression, headings, repetition, assumptions, evidence and separation of scenarios. Compare relevant claims with the attached asset context, keeping prior analysis distinct from facts. Return actionable comments tied to passages where possible, and identify missing evidence or structural gaps. Do not rewrite the whole article.",
  },
  custom: {
    label: "Custom prompt",
    words: 300,
    format: "text",
    prompt:
      "Use the attached asset context and draft to help me develop the following idea:\n\n",
  },
});

// Editing one preset does not discard edits made to another during this session.
export function createWritingPresetState() {
  const prompts = new Map();
  return {
    save(task, prompt) {
      prompts.set(task, prompt);
    },
    get(task) {
      return prompts.get(task) ?? writingPresets[task].prompt;
    },
    reset(task) {
      prompts.delete(task);
      return writingPresets[task].prompt;
    },
  };
}
