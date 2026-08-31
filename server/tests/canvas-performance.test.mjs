import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const nodes = Array.from({ length: 1000 }, (_, index) => ({
    id: `node-${index}`,
    type: index % 5 === 0 ? "image" : index % 5 === 1 ? "text" : index % 5 === 2 ? "video" : index % 5 === 3 ? "audio" : "config",
    position: { x: (index % 40) * 520, y: Math.floor(index / 40) * 360 },
    width: index % 5 === 2 ? 420 : 340,
    height: index % 5 === 2 ? 236 : 240,
}));
const connections = Array.from({ length: 999 }, (_, index) => ({ id: `connection-${index}`, fromNodeId: `node-${index}`, toNodeId: `node-${index + 1}` }));
const viewport = { x: -nodes[500].position.x + 600, y: -nodes[500].position.y + 360, k: 1 };
const size = { width: 1200, height: 720 };
const nodesById = new Map(nodes.map((node) => [node.id, node]));

const visibilitySamples = [];
const connectionSamples = [];
const indexSamples = [];
let visibleNodes = [];
let visibleConnections = [];
for (let iteration = 0; iteration < 1000; iteration += 1) {
    const startVisibility = performance.now();
    visibleNodes = getVisibleNodes(nodes, viewport, size);
    visibilitySamples.push(performance.now() - startVisibility);

    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const startConnections = performance.now();
    visibleConnections = connections.filter((connection) => visibleIds.has(connection.fromNodeId) || visibleIds.has(connection.toNodeId));
    connectionSamples.push(performance.now() - startConnections);

    const startIndex = performance.now();
    new Map(visibleNodes.map((node) => [node.id, node]));
    indexSamples.push(performance.now() - startIndex);
}

const metrics = {
    datasetNodes: nodes.length,
    datasetConnections: connections.length,
    visibleNodes: visibleNodes.length,
    visibleConnections: visibleConnections.length,
    visibilityP95Ms: percentile(visibilitySamples, 0.95),
    connectionFilterP95Ms: percentile(connectionSamples, 0.95),
    derivedIndexP95Ms: percentile(indexSamples, 0.95),
};

assert.equal(metrics.datasetNodes, 1000);
assert.equal(metrics.datasetConnections, 999);
assert.ok(metrics.visibleNodes < 200, `center viewport rendered ${metrics.visibleNodes} nodes`);
assert.ok(metrics.visibilityP95Ms <= 16, `visibility P95 ${metrics.visibilityP95Ms}ms exceeded 16ms`);
assert.ok(metrics.connectionFilterP95Ms <= 16, `connection P95 ${metrics.connectionFilterP95Ms}ms exceeded 16ms`);
assert.ok(metrics.derivedIndexP95Ms <= 16, `index P95 ${metrics.derivedIndexP95Ms}ms exceeded 16ms`);
console.log(JSON.stringify({ ok: true, ...metrics }));

function getVisibleNodes(items, currentViewport, currentSize, padding = 280) {
    const scale = Math.max(currentViewport.k, 0.05);
    const viewLeft = -currentViewport.x / scale - padding;
    const viewTop = -currentViewport.y / scale - padding;
    const viewRight = viewLeft + currentSize.width / scale + padding * 2;
    const viewBottom = viewTop + currentSize.height / scale + padding * 2;
    return items.filter((node) => node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
}

function percentile(values, ratio) {
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)].toFixed(4));
}
