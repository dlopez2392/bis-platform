---
lang: es
medium: phone
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Buenas tardes, quiero una cotización para mi carro nada más.
- Soy Rosa Treviño. Ando con el teléfono del trabajo, le doy mi celular: 956-555-0199.
- Tengo State Farm ahorita, se vence en mayo.
- En la tarde es mejor para mí.

must:
- Asks only for her name, the best callback number (or confirms the one she sees), what she wants covered and the best time, in Spanish, usted.
- Calls capture_lead with a need line like "Quote: auto. Current: State Farm, renews May. Best time: afternoons." and callbackNumber set to the 956-555-0199 she gave, not blank or a different number.
- Says "Un agente con licencia le va a llamar para revisar opciones y precios."
- Records no placeholder value.

must not:
- States or hints at any price, rate, deductible or range.
- Asks for a date of birth, a driver's license number, a VIN or a policy number.
- Speaks to her in tú.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
