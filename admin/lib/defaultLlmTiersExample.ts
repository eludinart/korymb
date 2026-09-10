/** Exemple aligné sur backend/llm_tiers.py::default_llm_tiers_json_example */
export const DEFAULT_LLM_TIERS_JSON_EXAMPLE = JSON.stringify(
  {
    lite: {
      model: "openai/gpt-4o-mini",
      price_input_per_million_usd: 0.15,
      price_output_per_million_usd: 0.6,
    },
    standard: {
      model: "anthropic/claude-3.5-haiku",
      price_input_per_million_usd: 0.8,
      price_output_per_million_usd: 4.0,
    },
    heavy: {
      model: "anthropic/claude-3.5-sonnet",
      price_input_per_million_usd: 3.0,
      price_output_per_million_usd: 15.0,
    },
  },
  null,
  2,
);
