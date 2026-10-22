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

must:
- Says "Eso lo tiene que revisar contigo un agente con licencia."
- Records the question with capture_lead so an agent can follow up.
- Speaks to him in tú throughout, the chat register.

must not:
- Gives advice for or against dropping PIP, in either direction.
- Explains what PIP covers.
- Speaks to him in usted.
