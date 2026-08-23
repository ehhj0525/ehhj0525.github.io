/**
 * The site is meant to sit on a phone's home screen with its own icon and no
 * browser bar around it, and a phone decides whether to offer that by reading
 * the manifest and finding the icons it names. None of that can be checked by
 * looking at the site: it either was offered or it was not, weeks later, on
 * somebody else's phone.
 *
 * So it is checked here — that the manifest says what a phone needs to hear,
 * that every icon it promises is really there and really the size it claims,
 * that the pages point at it, and that the app's name and language are still the
 * ones in config.json rather than a copy that drifted.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SHELL_FILES } from "../../cache-policy.js";

const ROOT = new URL("../../", import.meta.url);

const read = (name) => readFileSync(new URL(name, ROOT), "utf8");
const json = (name) => JSON.parse(read(name));

const manifest = json("manifest.webmanifest");
const config = json("config.json");

/** A PNG says its own size in the header, so it can be read without a library. */
function pngSize(name) {
  const bytes = readFileSync(new URL(name, ROOT));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${name} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the manifest", () => {
  it("names the app, which is what a phone puts under the icon", () => {
    assert.equal(manifest.name, config.title);
    assert.equal(manifest.short_name, config.title);
  });

  it("speaks the language the site is set to", () => {
    assert.equal(manifest.lang, config.language);
  });

  it("opens as an app rather than in a browser tab", () => {
    assert.equal(manifest.display, "standalone");
  });

  it("starts and stays where it is served from, wherever that is", () => {
    // Relative, so the same file works at the root of a site and in the
    // subdirectory a project page is served from.
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");
  });

  it("is painted the colour of the site, so it does not flash white on opening", () => {
    const background = /--bg:\s*(#[0-9a-f]{6})/i.exec(read("style.css"))?.[1];
    assert.equal(manifest.background_color, background);
    assert.equal(manifest.theme_color, background);
  });
});

describe("the icons the manifest promises", () => {
  it("are all really in the repository", () => {
    for (const icon of manifest.icons) {
      assert.doesNotThrow(() => read(icon.src), `${icon.src} is named but not here`);
    }
  });

  it("are the sizes they say they are, which is what a phone picks by", () => {
    for (const icon of manifest.icons.filter((each) => each.sizes !== "any")) {
      const [width, height] = icon.sizes.split("x").map(Number);
      assert.deepEqual(pngSize(icon.src), { width, height }, `${icon.src} is not ${icon.sizes}`);
    }
  });

  it("include the two sizes a phone will not install without", () => {
    const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
    assert.ok(sizes.has("192x192"), "no 192px icon");
    assert.ok(sizes.has("512x512"), "no 512px icon");
  });

  it("include one drawn for a launcher that crops it to its own shape", () => {
    const maskable = manifest.icons.find((icon) => icon.purpose === "maskable");
    assert.ok(maskable, "no maskable icon, so Android will crop the leaf");
  });
});

describe("the pages", () => {
  const pages = ["index.html", "upload.html"].map((name) => [name, read(name)]);

  it("point at the manifest, or nothing reads it", () => {
    for (const [name, html] of pages) {
      assert.match(html, /rel="manifest"\s+href="manifest\.webmanifest"/, name);
    }
  });

  it("give iOS an icon of its own, which is the only one it reads", () => {
    // Add to Home Screen on iOS ignores the manifest's icons entirely; without
    // this it screenshots the page and uses that.
    for (const [name, html] of pages) {
      assert.match(html, /rel="apple-touch-icon"/, name);
    }
  });

  it("colour the phone's own bars in both themes", () => {
    for (const [name, html] of pages) {
      assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: dark/, name);
    }
  });
});

describe("the files the installed app is built from", () => {
  /** Everything the site is made of, as served from the repository root. */
  const served = readdirSync(ROOT).filter(
    (name) =>
      /\.(js|css|html)$/.test(name) &&
      // The worker is fetched by the browser as the worker, never as one of the
      // files it is keeping.
      name !== "sw.js"
  );

  it("account for every page, stylesheet and module in the repository", () => {
    for (const name of served) {
      assert.ok(SHELL_FILES.includes(name), `${name} is not in the shell, so it will be missing offline`);
    }
  });

  it("are all really in the repository, so installing cannot half-fail", () => {
    for (const name of SHELL_FILES) {
      assert.doesNotThrow(() => read(name), `the shell names ${name}, which is not here`);
    }
  });
});
