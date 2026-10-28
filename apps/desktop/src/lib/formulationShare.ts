import { copyText } from "./clipboard";
import { toast } from "./toast";

/** Share the current result route through the platform share sheet when it is
 *  available, otherwise copy its link using the desktop-aware clipboard. */
export async function shareFormulationResult(sessionId: string): Promise<void> {
  const url = window.location.href;
  const data: ShareData = {
    title: "FormuLab formulation result",
    text: `Formulation session ${sessionId}`,
    url,
  };

  if (typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      // Dismissing the native share sheet is an intentional user action.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  try {
    await copyText(url);
    toast.success("Session link copied to clipboard.");
  } catch (error) {
    toast.error(`Could not share this session: ${error instanceof Error ? error.message : String(error)}`);
  }
}
