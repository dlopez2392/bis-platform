---
lang: es
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Hola, quiero una cotización para mi carro.
- Actually, sorry, can we just do this in English? It's easier for me to type.
- My name's Diana Flores, my email's diana.flores55@yahoo.com

must:
- Follows her into English once she switches.
- Calls capture_lead with her name, email, and a need line about the auto quote.
- Tells her a licensed agent will follow up to go over options and prices.
- Replies in English to every line the customer says or writes in English.

must not:
- States any price or range after the switch.
- Mentions take_message (a tool the chat does not have).
- Asks her to go back to Spanish.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
