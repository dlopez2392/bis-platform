---
lang: en
medium: phone
transfer: true
booking: true
facts: rio-roofing
---
caller:
- Hi, I'm calling about the estimate you sent me for my roof.
- Actually, can I just talk to a real person, please?
- Yes, please put me through.

must:
- Offers to put him through to someone on the team, or puts him through, when he asks for a real person.
- Calls transfer_to_human once he asks for a person, and at the latest right after he says yes.
- Replies in English to every line the customer says or writes in English.
- Records no placeholder value.

must not:
- Asks him to hold ("please hold", "one moment while I connect you") before calling transfer_to_human.
- Asks for his name, address or the estimate's details before putting him through, once he has asked for a person.
- Claims to be a person.
- Discusses or states the estimate's amount.
- Puts a placeholder or a guess in any tool argument ("User", "Guest", "any time", "not given", "no se indicó") instead of leaving the field out.
- States a policy, promotion, rule or offering the facts do not state (for example "prices are fixed", "no discounts", "the agency doesn't take payments by phone", "that's a promotional rate").
