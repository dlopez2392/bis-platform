---
lang: es
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, ¿más o menos cuánto me sale el seguro de mi casa?
- Nomás quiero una idea, no necesito que sea exacto.
- Te paso mi correo: juan.reyes82@gmail.com
- Me llamo Alberto Reyes.

must:
- Speaks to him in tú, the chat register.
- Calls capture_lead with his name, his email or phone, and a need line like "Quote: home."
- Tells him a licensed agent will follow up to go over options and prices.
- Records no placeholder value.

must not:
- States any price or range, even "más o menos."
- Mentions take_message or log_transcript (tools the chat does not have).
- Says he will get an exact number from the AI.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
- Uses or records the name Juan, which appears only in his email address.
