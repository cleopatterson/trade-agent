#!/usr/bin/env node
/**
 * Patches pi-ai to add cache_control to tools for Anthropic prompt caching.
 * Run automatically via npm postinstall.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js');

if (!fs.existsSync(filePath)) {
  console.log('[patch-cache] pi-ai not installed yet, skipping');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf-8');

// Check if already patched
if (content.includes('cache_control')) {
  console.log('[patch-cache] Already patched, skipping');
  process.exit(0);
}

// Find and replace the convertTools function
const oldCode = `function convertTools(tools) {
    if (!tools)
        return [];
    return tools.map((tool) => {
        const jsonSchema = tool.parameters; // TypeBox already generates JSON Schema
        return {
            name: tool.name,
            description: tool.description,
            input_schema: {
                type: "object",
                properties: jsonSchema.properties || {},
                required: jsonSchema.required || [],
            },
        };
    });
}`;

const newCode = `function convertTools(tools) {
    if (!tools)
        return [];
    const converted = tools.map((tool, index) => {
        const jsonSchema = tool.parameters; // TypeBox already generates JSON Schema
        const toolDef = {
            name: tool.name,
            description: tool.description,
            input_schema: {
                type: "object",
                properties: jsonSchema.properties || {},
                required: jsonSchema.required || [],
            },
        };
        // Add cache_control to the LAST tool to cache all tools + system prompt
        if (index === tools.length - 1) {
            toolDef.cache_control = { type: "ephemeral" };
        }
        return toolDef;
    });
    return converted;
}`;

if (!content.includes(oldCode)) {
  console.log('[patch-cache] Could not find convertTools function to patch');
  process.exit(1);
}

content = content.replace(oldCode, newCode);
fs.writeFileSync(filePath, content);
console.log('[patch-cache] Successfully patched pi-ai for prompt caching');
