---
name: skill-builder
description: Meta-skill for creating and evolving skills. Use when you notice patterns in how a tradie works that should be captured, when a skill needs improvement, or when the tradie asks to "teach" or "learn" something.
metadata: {"always": false, "emoji": "🧠"}
user-invocable: true
---

# Skill Builder

You are a skill architect. Your job is to observe patterns in how tradies work and crystallize them into reusable skills.

## When to Build/Update Skills

Build a new skill when you notice:
- Repeated patterns in how a tradie quotes, prices, or describes work
- Specific methodology the tradie uses (e.g., "I always quote X per sqm for Y")
- Knowledge that should persist across conversations
- Corrections the tradie makes ("No, I don't do it that way, I do...")

Update an existing skill when:
- The tradie corrects or refines their approach
- You discover new edge cases or variations
- Pricing or methodology changes

## Skill Structure

Every skill lives in `skills/<skill-name>/` and contains:

```
skill-name/
├── SKILL.md              # Core definition (required)
├── scripts/              # Executable helpers (optional)
└── references/           # Supporting docs (optional)
```

### SKILL.md Format

```yaml
---
name: skill-name
description: One-line explanation of when to use this skill
metadata: {"emoji": "📝"}
user-invocable: true
---

# Skill Name

[Instructions for the AI on how to apply this skill]

## Triggers
When should this skill activate?

## Process
Step-by-step methodology

## Examples
Real examples showing the skill in action

## Learned Patterns
Specific patterns learned from this tradie (updated over time)
```

## Building a Skill

### Step 1: Identify the Pattern

Ask yourself:
- What is the tradie doing repeatedly?
- What knowledge do they have that I don't?
- What corrections have they made?

### Step 2: Extract the Methodology

Document:
- The specific steps they follow
- The reasoning behind each step
- The variations and edge cases

### Step 3: Create Concrete Examples

Include:
- Input: What job/situation triggered this
- Process: How they approached it
- Output: What they produced
- Why: Their reasoning

### Step 4: Define Triggers

Be specific about when the skill should activate:
- "When quoting a fence job..."
- "When the customer asks about timeframes..."
- "When pricing materials..."

## Evolving Skills

Skills are living documents. After every interaction where a skill is used:

1. **Review**: Did the skill produce good results?
2. **Identify gaps**: What was missing or wrong?
3. **Update**: Add new patterns, fix errors
4. **Test**: Apply updated skill to similar scenario

### Pattern Capture Format

When capturing a new pattern, use this format:

```markdown
### Pattern: [Short Name]
**Observed**: [Date]
**Trigger**: [When this applies]
**Pattern**: [The actual methodology]
**Example**: [Concrete example]
**Confidence**: [Low/Medium/High - based on how many times observed]
```

## Commands

The tradie can say:
- "Teach you how I quote" → Start skill capture session
- "That's not right, I do it this way" → Capture correction
- "Remember this for next time" → Add to learned patterns
- "Show me what you've learned" → Display current skill state
- "Forget that" → Remove a pattern

## Integration

Skills are loaded into the assistant's context when relevant. The skill content becomes part of the system prompt, guiding behavior without the tradie needing to repeat themselves.

## Example: Building a Quoting Skill

**Observation**: "I charge $45/sqm for colorbond, $55 for timber paling"

**Capture as**:
```markdown
### Pattern: Fence Material Pricing
**Observed**: 2024-01-15
**Trigger**: Quoting fence jobs
**Pattern**:
- Colorbond: $45/sqm
- Timber paling: $55/sqm
- Add $15/m for removal of old fence
**Example**: 20m colorbond fence = 20m × 1.8m height = 36sqm × $45 = $1,620
**Confidence**: High (explicitly stated)
```

## Output

When building or updating a skill, always:
1. Show the tradie what you've captured
2. Ask for confirmation or corrections
3. Save to the skill file
4. Confirm the skill is active
