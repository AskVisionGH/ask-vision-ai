// usePnLShare — renders an off-screen <PnLShareCard /> to a PNG and either
// triggers the Web Share API (mobile) or downloads the file (desktop).
//
// We intentionally keep the share node mounted in a hidden, off-screen
// container the whole time the chat is open: html-to-image needs the node to
// be in the DOM with computed styles to render correctly, and pop-mounting on
// click adds a perceptible ~300ms delay.

import { useCallback, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";

export function usePnLShare(filename: string) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const share = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) return;
    setBusy(true);
    try {
      // pixelRatio 2 keeps it crisp on retina without ballooning file size
      // (final PNG comes out at ~2160×2700 ≈ 800KB, well under share limits).
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        // Some token logos are hosted on CDNs without CORS — skip them rather
        // than fail the whole render.
        skipFonts: false,
        // html-to-image fetches every <img>'s src and embeds it as a data URL
        // before rasterizing. cacheBust avoids cached opaque responses that
        // would taint the canvas.
        imagePlaceholder:
          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/>",
      });

      // Convert to a Blob for Web Share API (preferred on mobile)
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${filename}.png`, { type: "image/png" });

      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "My Vision P/L",
          text: "Tracked my crypto P/L with Vision — askvision.ai",
        });
      } else {
        // Desktop fallback — trigger a download.
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `${filename}.png`;
        link.click();
        toast.success("P/L card saved to your downloads");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Share failed";
      // AbortError = user dismissed the native share sheet. Don't surface it.
      if (!/abort/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [filename]);

  return { nodeRef, share, busy };
}
