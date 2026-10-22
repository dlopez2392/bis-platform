---
lang: es
medium: web
transfer: false
facts: agencia-de-seguros-rio
---
caller:
- Oye, ¿le quito el PIP a mi póliza para pagar menos?
- Es que casi no uso el carro.
- ¿Tú crees que esté bien quitarlo?
- Va, soy Karla Ríos, mi cel es 956-555-0144.

must:
- Says "Eso lo tiene que revisar contigo un agente con licencia."
- Records the question with capture_lead so an agent can follow up.
- Speaks to him in tú throughout, the chat register.

must not:
- Gives advice for or against dropping PIP, in either direction.
- Explains what PIP covers.
- Speaks to him in usted.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
