import { describe, it, expect } from "vitest";
import { Sanitizer } from "./sanitizer.ts";
import type { RunContext } from "../../run-context/run-context.ts";

describe("Sanitizer", () => {
  const sanitizer = new Sanitizer();

  describe("sanitize", () => {
    it("should remove script tags", async () => {
      const html = `
        <html>
          <head>
            <script>alert('dangerous');</script>
          </head>
          <body>
            <p>Safe content</p>
            <script src="evil.js"></script>
          </body>
        </html>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert('dangerous')");
      expect(result).not.toContain("evil.js");
      expect(result).toContain("Safe content", "Should keep safe content");
    });

    it("should remove style tags", async () => {
      const html = `
        <html>
          <head>
            <style>body { color: red; }</style>
          </head>
          <body>
            <p>Content</p>
          </body>
        </html>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<style");
      expect(result).not.toContain("color: red");
      expect(result).toContain("Content", "Should keep content");
    });

    it("should preserve safe HTML tags while keeping text content", async () => {
      const html = `
        <div>
          <h1>Title</h1>
          <p>Paragraph <strong>with bold</strong> text</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).toContain("<h1");
      expect(result).toContain("<p");
      expect(result).toContain("<strong");
      expect(result).toContain("Title", "Should keep heading text");
      expect(result).toContain("Paragraph", "Should keep paragraph text");
      expect(result).toContain("with bold", "Should keep nested text");
      expect(result).toContain("Item 1", "Should keep list items");
    });

    it("should remove noisy tags like svg and canvas", async () => {
      const html = `
        <div>
          <p>Text</p>
          <svg><circle cx="50" cy="50" r="40" /></svg>
          <canvas id="myCanvas"></canvas>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<svg");
      expect(result).not.toContain("<canvas");
      expect(result).toContain("Text", "Should keep text content");
    });

    it("should remove iframe tags", async () => {
      const html = `
        <div>
          <p>Content</p>
          <iframe src="https://example.com" width="300" height="200"></iframe>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<iframe");
      expect(result).not.toContain("example.com");
      expect(result).toContain("Content", "Should keep other content");
    });

    it("should remove object and embed tags", async () => {
      const html = `
        <div>
          <p>Content</p>
          <object data="movie.swf" type="application/x-shockwave-flash">
            <param name="movie" value="movie.swf">
          </object>
          <embed src="movie.swf" type="application/x-shockwave-flash">
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<object");
      expect(result).not.toContain("<embed");
      expect(result).not.toContain("<param");
      expect(result).not.toContain("movie.swf");
      expect(result).toContain("Content", "Should keep other content");
    });

    it("should remove template tags", async () => {
      const html = `
        <div>
          <p>Content</p>
          <template id="my-template">
            <div>Template content</div>
          </template>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<template");
      expect(result).not.toContain("Template content");
      expect(result).toContain("Content", "Should keep other content");
    });

    it("should remove portal and other remaining forbidden tags", async () => {
      const html = `
        <div>
          <p>Content</p>
          <portal src="portal.html"></portal>
          <noframes>No frames content</noframes>
          <map name="map">
            <area shape="rect" coords="0,0,100,100" href="area.html">
          </map>
          <source src="audio.mp3" type="audio/mpeg">
          <track src="subtitles.vtt" kind="subtitles" srclang="en">
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("<portal");
      expect(result).not.toContain("<noframes");
      expect(result).not.toContain("<map");
      expect(result).not.toContain("<area");
      expect(result).not.toContain("<source");
      expect(result).not.toContain("<track");
      expect(result).not.toContain("No frames content");
      expect(result).not.toContain("portal.html");
      expect(result).not.toContain("area.html");
      expect(result).not.toContain("audio.mp3");
      expect(result).not.toContain("subtitles.vtt");
      expect(result).toContain("Content", "Should keep other content");
    });

    it("should handle empty input", async () => {
      const result = await sanitizer.sanitize({ html: "" });
      expect(result).toBe("", "Should return empty string for empty input");
    });

    it("should handle input with only whitespace", async () => {
      const html = "   \n\t  ";
      const result = await sanitizer.sanitize({ html });
      // Cheerio output for empty/whitespace might vary, but should be valid HTML
      expect(result).toContain("<body");
    });

    it("should save debug files if context is provided", async () => {
      const savedFiles: Array<{ filename: string; content: string; stageDir?: string }> = [];
      const mockCtx = {
        saveDebugFile: (params: { filename: string; content: string; stageDir?: string }) => {
          savedFiles.push(params);
          return Promise.resolve();
        },
      } as unknown as RunContext;

      const html = "<div>Test</div>";
      await sanitizer.sanitize({ html, ctx: mockCtx });

      expect(savedFiles.length).toBe(2);
      expect(savedFiles[0].filename).toBe("original.html");
      expect(savedFiles[1].filename).toBe("sanitized.html");
      expect(savedFiles[0].stageDir).toBe("sanitizer");
      expect(savedFiles[1].stageDir).toBe("sanitizer");
    });

    it("should return whole document if input is whole document", async () => {
      const html = `<!DOCTYPE html><html><body><p>Hello</p></body></html>`;
      const result = await sanitizer.sanitize({ html });

      expect(result).toContain("<html");
      expect(result).toContain("<body");
      expect(result).toContain("<p>Hello</p>");
    });

    it("should remove content inside forbidden tags", async () => {
      const html = `
        <div>
          <p>Visible content</p>
          <script>
            var dangerous = function() {
              // This should be removed
              alert('hacked!');
            };
          </script>
          <style>
            .hidden { display: none; }
            body { background: red; }
          </style>
          <template>
            <div id="template-content">This should not appear</div>
          </template>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      expect(result).not.toContain("var dangerous");
      expect(result).not.toContain("alert('hacked!')");
      expect(result).not.toContain(".hidden");
      expect(result).not.toContain("background: red");
      expect(result).not.toContain("template-content");
      expect(result).not.toContain("This should not appear");
      expect(result).toContain("Visible content", "Should keep visible content");
    });

    it("should preserve all attributes including dangerous ones", async () => {
      const html = `
        <div>
          <img src="image.jpg" onload="alert('xss')" onerror="evil()" onclick="hack()">
          <a href="javascript:alert('xss')" onmouseover="bad()" style="color: red">Link</a>
          <input type="text" oninput="stealData()">
          <form action="/safe">
            <button type="submit" formaction="javascript:evil()">Submit</button>
          </form>
          <div id="safe-div" class="safe-class" data-info="safe-data">Safe content</div>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      // Attributes should be preserved
      expect(result).toContain("onload=");
      expect(result).toContain("onerror=");
      expect(result).toContain("onclick=");
      expect(result).toContain("onmouseover=");
      expect(result).toContain("oninput=");
      expect(result).toContain("formaction=");
      expect(result).toContain("style=");
      expect(result).toContain("color: red");
      expect(result).toContain("javascript:alert");
      
      // Standard attributes should definitely be preserved
      expect(result).toContain('id="safe-div"');
      expect(result).toContain('class="safe-class"');
      expect(result).toContain('data-info="safe-data"');
      
      expect(result).toContain("Link", "Should keep link text");
    });

    it("should handle malformed HTML gracefully", async () => {
      const html = `
        <div>
          <p>Unclosed paragraph
          <script>Unclosed script
          <style>Unclosed style
          <p>Another paragraph</p>
          </unclosed>
        </div>
      `;

      const result = await sanitizer.sanitize({ html });

      // Cheerio should fix structure and remove forbidden tags
      expect(result).not.toContain("<script");
      expect(result).not.toContain("<style");
      expect(result).not.toContain("Unclosed script");
      expect(result).not.toContain("Unclosed style");
      expect(result).toContain("<p>");
      expect(result).toContain("Unclosed paragraph");
    });

    it("should preserve unknown tags that are not in blacklist", async () => {
      const html = `
        <div>
           <invalid>Invalid tag content</invalid>
           <custom-element>Custom</custom-element>
        </div>
      `;
      
      const result = await sanitizer.sanitize({ html });
      
      expect(result).toContain("<invalid>");
      expect(result).toContain("Invalid tag content");
      expect(result).toContain("<custom-element>");
    });
  });
});
