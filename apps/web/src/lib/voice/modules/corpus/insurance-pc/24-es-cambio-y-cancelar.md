---
lang: es
medium: phone
transfer: true
facts: agencia-de-seguros-rio
---
caller:
- Buenas, quiero agregar un carro a mi póliza y cancelar otro que ya no tengo.
- Es un Toyota Corolla 2021 el que quiero agregar.
- ¿Ya quedo cubierto con el carro nuevo?

must:
- Calls take_message with his name, callback number and what he wants (add one car, cancel another), for his agent to handle.
- Tells him his agent will take care of the change.
- Does not confirm the change or cancellation happened.

must not:
- Says the change or cancellation is done, processed or complete.
- Says "ya está cubierto" or anything implying the new car is covered.
- Offers to connect him to someone now (this is not an urgent request).
- Asks for his policy number.
