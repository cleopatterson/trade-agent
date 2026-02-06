/**
 * Trade MCP Server
 *
 * MCP server for trade/provider-facing tools:
 * - Profile management and analysis
 * - Job review and quoting
 * - Business insights
 *
 * Runs separately from the customer MCP server (index.js in parent dir)
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.TRADE_MCP_PORT || 3001;
const MCP_API_KEY = process.env.MCP_API_KEY || 'ss-mcp-2024-9k7m3n8q5r2w6x1z4v';

// Load mock data
const MOCK_DIR = path.join(__dirname, '..', 'resources', 'mock');

function loadMockProfile(businessId) {
  const filePath = path.join(MOCK_DIR, `business_${businessId}_profile.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return { success: false, error: `Profile not found for business ${businessId}` };
}

function loadMockJobs(businessId) {
  const filePath = path.join(MOCK_DIR, `jobs_for_business_${businessId}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return { success: false, jobs: [], jobs_count: 0 };
}

// ============== MCP TOOLS DEFINITION ==============

const tools = [
  {
    name: "get_trade_profile",
    description: "Get a business/trade profile including service areas, pricing, credentials, and performance stats.",
    inputSchema: {
      type: "object",
      properties: {
        business_id: {
          type: "string",
          description: "Business identifier to get profile for"
        }
      },
      required: ["business_id"]
    }
  },
  {
    name: "get_business_jobs",
    description: "Get a list of jobs matched to a business based on their service areas and categories. Returns jobs that are available for quoting, sorted by match score and urgency.",
    inputSchema: {
      type: "object",
      properties: {
        business_id: {
          type: "string",
          description: "Business identifier to get matched jobs for"
        },
        status: {
          type: "string",
          description: "Filter by job status: 'open' (accepting quotes), 'quoted' (already quoted), 'all'",
          enum: ["open", "quoted", "all"],
          default: "open"
        },
        sort_by: {
          type: "string",
          description: "Sort order: 'match_score', 'posted_at', 'distance', 'urgency'",
          enum: ["match_score", "posted_at", "distance", "urgency"],
          default: "match_score"
        },
        limit: {
          type: "number",
          description: "Maximum number of jobs to return",
          default: 10
        }
      },
      required: ["business_id"]
    }
  },
  {
    name: "get_job_details",
    description: "Get full details for a specific job including customer info, attachments, and existing responses.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Job identifier to get details for"
        },
        business_id: {
          type: "string",
          description: "Business ID for distance calculation (optional)"
        }
      },
      required: ["job_id"]
    }
  },
  {
    name: "respond_to_job",
    description: "Submit a response (quote, question, or decline) to a job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Job identifier to respond to"
        },
        business_id: {
          type: "string",
          description: "Business identifier submitting the response"
        },
        response_type: {
          type: "string",
          description: "Type of response: 'quote', 'question', or 'decline'",
          enum: ["quote", "question", "decline"]
        },
        message: {
          type: "string",
          description: "Message to the customer"
        },
        quote_amount: {
          type: "number",
          description: "Quote amount in dollars (required for 'quote' type)"
        },
        quote_includes: {
          type: "string",
          description: "What's included in the quote"
        },
        estimated_duration: {
          type: "string",
          description: "Estimated job duration (e.g., '2-3 days')"
        },
        available_start_date: {
          type: "string",
          description: "When the tradie can start (ISO 8601 date)"
        },
        decline_reason: {
          type: "string",
          description: "Reason for declining (for 'decline' type)"
        }
      },
      required: ["job_id", "business_id", "response_type", "message"]
    }
  },
  {
    name: "update_trade_profile",
    description: "Update business profile preferences and settings.",
    inputSchema: {
      type: "object",
      properties: {
        business_id: {
          type: "string",
          description: "Business identifier to update"
        },
        description: {
          type: "string",
          description: "New business description"
        },
        hourly_rate_min: {
          type: "number",
          description: "Minimum hourly rate"
        },
        hourly_rate_max: {
          type: "number",
          description: "Maximum hourly rate"
        },
        minimum_job: {
          type: "number",
          description: "Minimum job value"
        },
        max_travel_km: {
          type: "number",
          description: "Maximum travel distance in kilometers"
        },
        preferred_job_sizes: {
          type: "array",
          items: { type: "string" },
          description: "Preferred job sizes: 'small', 'medium', 'large'"
        },
        availability: {
          type: "string",
          description: "Availability: 'weekdays', 'weekends', or 'all'"
        }
      },
      required: ["business_id"]
    }
  }
];

// ============== TOOL HANDLERS ==============

async function handleToolCall(name, args) {
  switch (name) {
    case 'get_trade_profile': {
      const profile = loadMockProfile(args.business_id);
      return profile;
    }

    case 'get_business_jobs': {
      const jobs = loadMockJobs(args.business_id);
      // Apply sorting if specified
      if (jobs.jobs && args.sort_by) {
        jobs.jobs.sort((a, b) => {
          switch (args.sort_by) {
            case 'match_score': return (b.match_score || 0) - (a.match_score || 0);
            case 'posted_at': return new Date(b.posted_at) - new Date(a.posted_at);
            case 'distance': return (a.distance_km || 999) - (b.distance_km || 999);
            case 'urgency': return (b.urgency === 'urgent' ? 1 : 0) - (a.urgency === 'urgent' ? 1 : 0);
            default: return 0;
          }
        });
      }
      // Apply limit
      if (args.limit && jobs.jobs) {
        jobs.jobs = jobs.jobs.slice(0, args.limit);
      }
      return jobs;
    }

    case 'get_job_details': {
      // Try to find the job in available mock jobs
      const jobs = loadMockJobs(args.business_id || '123');
      const job = jobs.jobs?.find(j => j.job_id === args.job_id);
      if (job) {
        return { success: true, job_found: true, job };
      }
      return { success: false, job_found: false, message: `Job ${args.job_id} not found` };
    }

    case 'respond_to_job': {
      // Simulate submitting a response
      return {
        success: true,
        simulated: true,
        response_id: `resp_${Date.now()}`,
        job_id: args.job_id,
        business_id: args.business_id,
        response_type: args.response_type,
        message: "Response submitted (simulated)",
        timestamp: new Date().toISOString()
      };
    }

    case 'update_trade_profile': {
      // Simulate profile update
      const profile = loadMockProfile(args.business_id);
      return {
        success: true,
        simulated: true,
        message: "Profile updated (simulated)",
        business_id: args.business_id,
        fields_updated: Object.keys(args).filter(k => k !== 'business_id'),
        timestamp: new Date().toISOString()
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ============== MCP PROTOCOL ENDPOINTS ==============

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];

  const providedKey = authHeader?.replace('Bearer ', '') || apiKey;

  if (!providedKey || providedKey !== MCP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'trade-mcp-server',
    version: '1.0.0',
    tools_count: tools.length
  });
});

// MCP endpoint
app.post('/mcp', authenticate, async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '0.1.0',
          serverInfo: { name: 'Trade MCP Server', version: '1.0.0' },
          capabilities: { tools: {} }
        };
        break;

      case 'tools/list':
        result = { tools };
        break;

      case 'tools/call':
        const { name, arguments: args } = params || {};
        if (!name) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } });
        }
        const toolResult = await handleToolCall(name, args || {});
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;

      case 'resources/list':
        result = { resources: [] };
        break;

      case 'resources/read':
        result = { contents: [] };
        break;

      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    console.error('MCP Error:', error);
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

// ============== START SERVER ==============

app.listen(PORT, () => {
  console.log(`Trade MCP Server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`MCP: http://localhost:${PORT}/mcp`);
  console.log(`Tools available: ${tools.map(t => t.name).join(', ')}`);
});
