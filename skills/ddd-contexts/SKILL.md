---
name: ddd-contexts
description: Design bounded contexts, responsibilities, ownership, and ubiquitous language from approved strategic discovery and subdomains. A bounded context is not automatically a microservice.
---

# Bounded contexts and ubiquitous language

## Terms

- **Bounded context**: an explicit boundary within which one domain model and vocabulary have consistent meaning and ownership.
- **Ubiquitous language**: terms and rules used consistently by domain experts, documents, models, code, and tests inside a bounded context.
- **Responsibility**: the business decisions and information a context owns.
- **Non-responsibility**: a business decision the context must not make.
- **Data ownership**: authority to create and change business facts, not merely permission to read a table.

## Method

1. Cluster capabilities where language, rules, lifecycle, ownership, and change cadence cohere.
2. Define each context's responsibilities, non-responsibilities, owned decisions, events, and data.
3. Build a glossary with definition, example, synonyms, forbidden ambiguous terms, and translation needs.
4. Resolve same-name/different-meaning and different-name/same-meaning conflicts explicitly.
5. Record boundary alternatives and ADR reasoning.

Do not equate contexts with existing modules, teams, tables, or microservices without a separate deployment decision.
