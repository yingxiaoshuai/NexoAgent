import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const browserManagerModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron", "electron", "server", "browser-manager.js")));
const browserEmbeddingModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron", "electron", "server", "browser-embedding.js")));

const { BrowserManager } = browserManagerModule;
const { browserEmbeddingService } = browserEmbeddingModule;
const originalEmbed = browserEmbeddingService.embed.bind(browserEmbeddingService);

function okState(action = "run") {
  return {
    ok: true,
    url: "https://mail.test",
    title: "Mail",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    presentation: "hidden",
    zoomFactor: 1,
    history: [],
    elements: [],
    text: "",
    lastAction: action,
  };
}

function seedManager() {
  const manager = new BrowserManager();
  manager.setTestSnapshotData([
    ["e1", "button.compose"],
    ["e2", "input.to"],
    ["e3", "button.send"],
  ], [
    {
      ref: "e1",
      tag: "button",
      role: "button",
      name: "Compose",
      text: "Compose",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Compose | button | toolbar | enabled",
      context: "toolbar",
      bounds: { x: 20, y: 20, width: 120, height: 32 },
    },
    {
      ref: "e2",
      tag: "input",
      role: "textbox",
      name: "To",
      placeholder: "Recipient",
      text: "",
      editable: true,
      visible: true,
      enabled: true,
      descriptorText: "Recipient | To | textbox | enabled",
      context: "compose dialog",
      bounds: { x: 20, y: 80, width: 240, height: 32 },
    },
    {
      ref: "e3",
      tag: "button",
      role: "button",
      name: "Send",
      text: "Send",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Send | button | compose dialog | enabled",
      context: "compose dialog",
      bounds: { x: 20, y: 140, width: 100, height: 32 },
    },
  ], "e1");
  return manager;
}

browserEmbeddingService.embed = async (texts) => {
  const vectors = new Map();
  for (const text of texts) {
    const normalized = String(text).toLowerCase();
    if (normalized.includes("send")) vectors.set(text, [1, 0, 0]);
    else if (normalized.includes("recipient") || normalized.includes("textbox")) vectors.set(text, [0, 1, 0]);
    else if (normalized.includes("compose")) vectors.set(text, [0, 0, 1]);
    else vectors.set(text, [0.1, 0.1, 0.1]);
  }
  return { vectors, ready: true, pending: false };
};

{
  const manager = seedManager();
  const steps = manager.normalizeRunSteps({
    action: "run",
    text: "test@example.com",
    target: { query: "recipient" },
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].op, "type");
}

{
  const manager = seedManager();
  const resolved = await manager.resolveTarget({ query: "send", role: "button" }, "click", "auto", 0.72);
  assert.equal(resolved.ref, "e3");
  assert.ok(Boolean(resolved.resolve?.candidates.length));
  assert.ok(["semantic", "dom"].includes(resolved.actualStrategy));
}

{
  const manager = seedManager();
  const resolved = await manager.resolveTarget({ query: "recipient", role: "textbox" }, "type", "auto", 0.72);
  assert.equal(resolved.ref, "e2");
}

{
  const manager = seedManager();
  browserEmbeddingService.embed = async () => ({
    vectors: new Map(),
    ready: false,
    pending: false,
    error: "MiniLM unavailable",
  });
  try {
    const resolved = await manager.resolveTarget({ query: "send", role: "button" }, "click", "auto", 0.72);
    assert.equal(resolved.ref, "e3");
    assert.equal(resolved.resolve?.semanticReady, false);
    assert.ok(Boolean(resolved.resolve?.candidates.length));
  } finally {
    browserEmbeddingService.embed = async (texts) => {
      const vectors = new Map();
      for (const text of texts) {
        const normalized = String(text).toLowerCase();
        if (normalized.includes("send")) vectors.set(text, [1, 0, 0]);
        else if (normalized.includes("recipient") || normalized.includes("textbox")) vectors.set(text, [0, 1, 0]);
        else if (normalized.includes("compose")) vectors.set(text, [0, 0, 1]);
        else vectors.set(text, [0.1, 0.1, 0.1]);
      }
      return { vectors, ready: true, pending: false };
    };
  }
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 1,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  manager.snapshot = async (action) => okState(action);
  manager.executeRunStep = async (index, step) => ({
    index,
    op: step.op,
    ok: true,
    strategy: "stub",
    selectedRef: `e${index + 1}`,
  });
  const response = await manager.executeAction({
    action: "run",
    goal: "Compose and send a test email",
    steps: [
      { op: "click", target: { query: "compose", role: "button" } },
      { op: "type", target: { query: "recipient" }, text: "test@example.com" },
      { op: "click", target: { query: "send", role: "button" } },
    ],
  });
  assert.equal(response.ok, true);
  assert.equal(response.run?.steps.length, 3);
  assert.equal(response.run?.completedSteps, 3);
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.snapshot = async () => okState("snapshot");
  manager.resolve = async () => ({ ...okState("resolve"), resolve: { query: "x", candidates: [], semanticModel: "Xenova/all-MiniLM-L6-v2", semanticReady: false, minConfidence: 0.72 } });
  manager.click = async () => okState("click");
  manager.type = async () => okState("type");
  manager.scroll = async () => okState("scroll");

  assert.equal((await manager.executeAction({ action: "snapshot" })).lastAction, "snapshot");
  assert.equal((await manager.executeAction({ action: "resolve", target: { query: "send" } })).lastAction, "resolve");
  assert.equal((await manager.executeAction({ action: "click", target: { query: "send" } })).lastAction, "click");
  assert.equal((await manager.executeAction({ action: "type", target: { query: "recipient" }, text: "hello" })).lastAction, "type");
  assert.equal((await manager.executeAction({ action: "scroll", direction: "down", amount: 200 })).lastAction, "scroll");
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 1,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  let clickPoint;
  manager.sendMouseClickPoint = async (x, y, bounds) => {
    clickPoint = { x, y, bounds };
    return { strategy: "stub", x, y, bounds };
  };

  const response = await manager.executeAction({
    action: "click",
    target: { bounds: { x: 595, y: 228, width: 37, height: 37 } },
    strategy: "coordinate",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(clickPoint, {
    x: 614,
    y: 247,
    bounds: { x: 595, y: 228, width: 37, height: 37 },
  });
}

{
  const manager = seedManager();
  await assert.rejects(
    manager.executeAction({ action: "click", query: "send" }),
    /no longer accepts top-level query/i,
  );
}

console.log("browser_action.run verification passed");
browserEmbeddingService.embed = originalEmbed;
process.exit(0);
