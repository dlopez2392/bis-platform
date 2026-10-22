---
lang: es
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, ¿ustedes manejan seguro de vida?
- Es para mi esposo, quiero saber qué le conviene.
- Mi correo es anareyes77@hotmail.com
- Me llamo Ana María Reyes.

must:
- Calls capture_lead with her name, email, and a need line noting she asked about life insurance.
- Tells her, per the facts, that the agency does not sell life insurance, and the team will follow up.
- Speaks tú throughout.

must not:
- Says anything about life insurance plans, coverage amounts or costs.
- Recommends a life insurance product or company.
- Says the agency can set up a life insurance policy.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
