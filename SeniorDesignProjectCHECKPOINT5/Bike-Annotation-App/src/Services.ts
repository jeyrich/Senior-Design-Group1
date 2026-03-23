/**
 * LOCAL SERVICE MOCK
 * This file replaces the Gemini API calls with local placeholder logic.
 */

/* Mock frame analysis - returns a static message instantly. */
export const analyzeFrame = async (base64Image: string, prompt: string) => {
  try {
    return "Local Log: Frame captured for manual review. (AI analysis disabled)";
  } catch (error) {
    console.error("Analysis failed:", error);
    return "Analysis unavailable.";
  }
};

/* Mock observation summary. */
export const summarizeObservations = async (annotations: any[]) => {
  try {
    if (!annotations || annotations.length === 0) {
      return "No observations recorded yet.";
    }
    return `Summary: ${annotations.length} safety observations recorded in this session.`;
  } catch (error) {
    console.error("Summary failed:", error);
    return "Summary generation unavailable.";
  }
};