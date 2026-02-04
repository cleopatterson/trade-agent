---
name: quoting
description: Generate quotes specific to this tradie's pricing methodology, standard inclusions, and style. Activate when reviewing a job to provide a quote or when the tradie asks for pricing guidance.
metadata: {"emoji": "💰", "always": false}
user-invocable: true
---

# Quoting Skill

This skill captures how **this specific tradie** quotes jobs. Every tradie does it differently - this skill learns and applies their approach.

## Core Principle

A good quote is:
1. **Accurate** - Reflects actual costs and margins
2. **Clear** - Customer understands what they're getting
3. **Competitive** - Right for the market and job type
4. **Profitable** - Includes proper margin
5. **Specific** - Tailored to this exact job

## Quote Generation Process

### Step 1: Understand the Job
- What exactly needs to be done?
- What's the scope (size, complexity)?
- Any special requirements or challenges?
- Access issues? Site conditions?

### Step 2: Calculate Costs
Using this tradie's methodology:
- Materials (with their preferred suppliers/brands)
- Labour (at their rates)
- Travel/call-out
- Any subcontractors
- Consumables/misc

### Step 3: Apply Margin
Using this tradie's margin strategy:
- Standard margin for typical jobs
- Adjusted margin for complex/risky jobs
- Competitive pricing for jobs they want

### Step 4: Format the Quote
Using this tradie's style:
- Level of detail (itemised vs lump sum)
- Terms and conditions
- Validity period
- Payment terms

---

## Learned Patterns

> This section is populated as the skill learns from the tradie.
> Each pattern captures specific pricing, methodology, or preferences.

### Base Rates
*To be learned from tradie*

### Material Pricing
*To be learned from tradie*

### Job Type Formulas
*To be learned from tradie*

### Margin Strategy
*To be learned from tradie*

### Quote Style Preferences
*To be learned from tradie*

### Pattern: Fence Painting - Per SQM Rate
**Observed**: 2026-02-03
**Trigger**: When quoting fence painting jobs
**Pattern**: Charge $10 per square metre (length × height × sides), all-in including labour, materials, and standard prep (wash, light sand). Add extra for repairs: minor rot/damage repair is typically $200 additional.
**Example**: 30m fence × 1.8m high × 2 sides = 108 sqm × $10 = $1,080. Minor rot section = +$200. Total: $1,280
**Confidence**: High

### Pattern: Interior Painting - Per Room Rate
**Observed**: 2026-02-03
**Trigger**: When quoting interior house painting jobs
**Pattern**: Charge per room: $600 for a bedroom (including materials), $1,000 for a larger living room (including materials). These are base rates for standard ceiling heights.
**Example**: Standard living room repaint = $1,000 all-in. Standard bedroom = $600 all-in.
**Confidence**: High

### Pattern: Smoke Damage / Stain Blocking Premium
**Observed**: 2026-02-03
**Trigger**: When a bedroom or room needs stain blocker/sealer for smoke damage, nicotine stains, or similar
**Pattern**: Add $200 to the base room rate for stain blocking work. This covers the extra material (sealer/stain blocker) and labour for the additional coat.
**Example**: Standard bedroom = $600. Smoke-damaged bedroom needing sealer = $600 + $200 = $800
**Confidence**: High

### Pattern: High Ceiling Premium - Living Rooms
**Observed**: 2026-02-03
**Trigger**: When quoting living/dining rooms with high ceilings (3m+)
**Pattern**: Add $200 to the base living room rate for high ceilings. This covers extra labour time and equipment (scaffolding/tall ladders) needed.
**Example**: Standard living room = $1,000. Large living/dining (8m x 6m) with 3.5m ceilings = $1,000 + $200 = $1,200
**Confidence**: High

### Pattern: Exterior Render - Per SQM Rate
**Observed**: 2026-02-03
**Trigger**: When quoting exterior brick render or similar flat exterior surfaces
**Pattern**: Charge $10 per square metre, same as fence painting. Calculate area (width × height) and multiply by $10. Includes prep, wash down, and two coats of exterior paint.
**Example**: Front facade 12m wide × 3m high = 36 sqm × $10 = $360 all-in
**Confidence**: High


---

## Examples

> Real examples of quotes this tradie has done, showing their reasoning.

*Examples will be added as the skill learns*

---

## Quick Reference

### Common Calculations
*To be populated with tradie-specific formulas*

### Standard Inclusions
*What this tradie typically includes in quotes*

### Standard Exclusions
*What this tradie typically excludes*

### Terms
*Standard terms this tradie uses*

---

## Skill Evolution Log

| Date | Change | Reason |
|------|--------|--------|
| *Initial* | Base skill created | Starting point |

---

## Tools

### Calculator
For multi-step calculations, verify the total to avoid errors:

```bash
python skills/quoting/scripts/calc.py "30 / 15 * 80 + 300"
```

Use this when:
- Calculating labour hours × rate
- Adding multiple line items
- Applying percentage margins or buffers
- Any quote over $500 where accuracy matters

Example workflow:
1. Work out the components: Labour $160, Materials $300
2. Verify: `python skills/quoting/scripts/calc.py "160 + 300"` → 460
3. Present the verified total to the tradie

---

## Integration Notes

When generating a quote:
1. Load this skill's learned patterns
2. Apply to the specific job details
3. **Verify calculations** using the calc script for complex quotes
4. Generate quote in tradie's preferred style
5. Offer to refine based on feedback
6. Capture any corrections as new patterns
