---
name: ddd-subdomains
description: Classify business capabilities from approved Big Picture EventStorming into Core, Supporting, and Generic subdomains during strategic design.
---

# Subdomain design

## Terms

- **Domain**: the business problem space addressed by the system.
- **Subdomain**: a cohesive business capability area in the problem space, not a code package or deployment unit.
- **Core subdomain**: creates business differentiation and deserves concentrated domain expertise and investment.
- **Supporting subdomain**: necessary for the business but not differentiating; it is often organization-specific.
- **Generic subdomain**: a broadly solved capability that can usually be bought, reused, or implemented conventionally.

## Method

1. Extract capabilities from approved events, policies, rules, and business outcomes.
2. Group by business purpose and language, not current tables or packages.
3. Compare differentiation, complexity, change frequency, and strategic investment.
4. Give every classification a business reason and ownership recommendation.
5. State the core-domain hypothesis and how success is measured.

A subdomain classification does not determine a bounded context or microservice one-to-one.
