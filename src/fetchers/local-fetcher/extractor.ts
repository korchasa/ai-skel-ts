/**
 * HTML content and metadata extraction helpers.
 *
 * Purpose: extract structured metadata and readable content from HTML in one operation.
 */

import metascraper from "metascraper";
import metascraperAuthor from "metascraper-author";
import metascraperDate from "metascraper-date";
import metascraperDescription from "metascraper-description";
import metascraperImage from "metascraper-image";
import metascraperLang from "metascraper-lang";
import metascraperLogo from "metascraper-logo";
import metascraperPublisher from "metascraper-publisher";
import metascraperTitle from "metascraper-title";
import metascraperUrl from "metascraper-url";
import metascraperAudio from "metascraper-audio";
import metascraperVideo from "metascraper-video";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { RunContext } from "../../run-context/run-context.ts";
import type { ExtractedData } from "../types.ts";

/**
 * Extracts structured metadata and readable content from HTML.
 *
 * @param params - Parameters including sanitized HTML and run context.
 * @returns Object containing extracted content and metadata.
 */
export async function extract({ html }: Readonly<{ html: string }>): Promise<ExtractedData> {
  if (!html) return {
    url: null,
    canonicalUrl: null,
    title: null,
    description: null,
    image: null,
    author: null,
    publisher: null,
    date: null,
    lang: null,
    logo: null,
    audio: null,
    video: null,
    text: "",
    html: null,
  };

  // Initialize metadata scraper
  const scraper = metascraper([
    metascraperTitle(),
    metascraperDescription(),
    metascraperImage(),
    metascraperAuthor(),
    metascraperPublisher(),
    metascraperDate(),
    metascraperLang(),
    metascraperLogo(),
    metascraperUrl(),
    metascraperAudio(),
    metascraperVideo(),
  ]);

  // Extract metadata
  const metadataPromise = scraper({
    html,
    url: "https://example.com",
  });

  // Initialize JSDOM with virtual console to filter CSS errors
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (error.message && error.message.includes("Could not parse CSS stylesheet")) {
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[JSDOM Error]", error);
  });

  // Extract content
  const dom = new JSDOM(html, { virtualConsole });
  let text = "";
  let extractedHtml: string | null = null;

  try {
    const article = new Readability(dom.window.document).parse();
    text = article?.textContent?.trim() ?? "";
    extractedHtml = article?.content ?? null;

    // Fallback: if Readability didn't extract text, try to extract from body
    if (!text) {
      const body = dom.window.document.body;
      if (body) {
        // Remove script and style tags
        const scripts = body.querySelectorAll('script, style');
        // @ts-ignore: DOM element remove method
        scripts.forEach(el => el.remove());

        text = body.textContent?.trim() ?? "";
        extractedHtml = body.innerHTML ?? null;
      }
    }
  } finally {
    dom.window.close();
  }

  // Wait for metadata and combine results
  const metadata = await metadataPromise;

  return {
    url: null, // Don't extract URL from metadata since we don't pass real URL
    canonicalUrl: null,
    title: (metadata as { title?: string }).title ?? null,
    description: (metadata as { description?: string }).description ?? null,
    image: (metadata as { image?: string }).image ?? null,
    author: (metadata as { author?: string }).author ?? null,
    publisher: (metadata as { publisher?: string }).publisher ?? null,
    date: (metadata as { date?: string }).date ?? null,
    lang: (metadata as { lang?: string }).lang ?? null,
    logo: (metadata as { logo?: string }).logo ?? null,
    audio: (metadata as { audio?: string }).audio ?? null,
    video: (metadata as { video?: string }).video ?? null,
    text,
    html: extractedHtml,
  };
}
