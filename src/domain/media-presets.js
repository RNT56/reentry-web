export const mediaPresets = {
  suggest:
    "Suggest up to three visuals that clarify this article's central thesis. For each, explain its purpose and where it belongs. Use only supplied evidence for numbers. Return a complete editable proposal when evidence is sufficient; otherwise explain the missing data without inventing it.",
  chart:
    "Create one chart that supports the central thesis using the attached asset evidence or supplied dataset. Preserve exact values, periods and units. Include source links and a concise caption. Leave missing values empty. Explain why this chart is useful.",
  table:
    "Organize the supplied evidence into one concise comparison table. Preserve dates, units and qualifications, include source links, and distinguish assumptions from reported facts.",
  statistics:
    "Extract a small set of useful statistics for this article. Use exact sourced values. Include the underlying data and sources; the application will calculate aggregates. Do not invent numbers.",
  diagram:
    "Turn the central causal mechanism in this draft into three to six ordered steps. Keep assumptions distinct from observed evidence. Each step needs a short label and one sentence explaining the connection to the next.",
  timeline:
    "Create a timeline of the relevant events in the supplied evidence. Keep reported events separate from future scenario milestones. Include dates, concise descriptions and source links.",
  image:
    "Create one restrained editorial illustration for this article's central idea. Use the selected asset context for relevance. No invented data, chart axes, statistics or quotations. Use a dark charcoal palette with subtle lime accents, clean composition and room around the subject. No text or watermark-like lettering.",
};
