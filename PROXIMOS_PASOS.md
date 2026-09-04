# Próximos pasos para vender Manoo

## ✅ Ya hecho (gratis, listo)

- Producto funcionando: Free (25 acciones/sesión) + Pro (ilimitado + audit log), con licencias firmadas Ed25519.
- Página de aterrizaje con precios (`site/index.html`) — Free $0, Pro $29 USD/año (placeholder, confirma el precio).
- Términos de Servicio (`LEGAL_TERMINOS_DE_SERVICIO.md`) y Aviso de Privacidad (`LEGAL_AVISO_DE_PRIVACIDAD.md`) — borradores funcionales.
- Logo real de Corporación Jamiel integrado.
- Investigación de dominio (`manoo.ai`/`manoo.dev` libres) y marca (borrador de clases 9/42 para IMPI).

## 🟢 Puedes vender HOY mismo, sin nada más (manual)

1. Alguien te contacta (por ahora, el botón "Get Pro" manda un correo a tu Gmail).
2. Te paga como puedas cobrar ahora mismo (transferencia, efectivo, Mercado Pago personal).
3. Corres: `node ~/manoo/licensing/mint-license.mjs --email correo@cliente.com --plan pro --days 365`
4. Le mandas la clave que imprime, y le dices que la active con `license_activate` en Claude Code.

Cero código nuevo necesario para tu primera venta.

## 🤖 Cobro 100% automático (ya construido, falta que crees las cuentas)

`~/manoo/automation/` — Cloudflare Worker que recibe el pago de **Stripe**
(cambiado de Mercado Pago por tu preferencia), lo re-verifica directo con
la API de Stripe (nunca confía en el webhook solo), emite la licencia, y
manda el correo — sin que tú toques nada por venta. También renueva la
licencia solo cada año, sin intervención.

Probado de verdad: el bundle compila limpio, la firma de licencia que
genera es 100% compatible con el plugin ya instalado, y la verificación
de firma del webhook de Stripe está probada localmente (acepta válidas,
rechaza manipuladas) — a diferencia de Mercado Pago, el formato de Stripe
sí está 100% documentado, no hay incertidumbre aquí.

Necesitas crear (gratis, ~30-40 min la primera vez): cuenta Stripe, cuenta
Resend, cuenta Cloudflare. Guía paso a paso completa en
`automation/SETUP.md` — está diseñada para que nunca me pases tus tokens
a mí, van directo de tu terminal a los secretos de Cloudflare. Tu Banco
Azteca funciona sin problema para recibir los pagos (Stripe paga en
México vía SPEI a cualquier banco).

## 🟡 Gratis pero requiere que TÚ lo hagas (necesita tu cuenta/identidad)

En orden de impacto:

1. **Subir el plugin a GitHub** (repo público) — para que cualquiera pueda instalarlo con `claude plugin marketplace add`, no solo tú localmente. Dime tu usuario de GitHub y te dejo todo listo para el push.
2. **Publicar la página** en GitHub Pages (`site/index.html` ya está lista) — mismo repo, gratis.
3. **Reservar `manoo.is-a.dev`** — plantilla y pasos ya te los di, solo falta que hagas el PR con tu cuenta.
4. **Crear cuenta de Mercado Pago** y generar un link de pago fijo para Manoo Pro — así el comprador paga solo, sin que tú manejes nada manual más que emitir la licencia. Gratis, ~10 minutos.
5. **Confirmar el precio real** de Pro (dejé $29 USD/año de referencia).

## 🔴 Esto sí cuesta dinero (cuando quieras dar el siguiente salto)

- Dominio `manoo.ai` (~$160 USD por 2 años) — no urgente, is-a.dev cubre mientras tanto.
- Registro de marca ante IMPI (~$5,600 MXN de tarifas + opcional búsqueda/agente) — sí conviene no tardar mucho por ser "primero en presentar".
- Procesador de pago automatizado tipo Lemon Squeezy/Paddle (comisión por venta, no costo fijo) — para cuando el volumen ya no aguante el flujo manual.

## Decisiones ya tomadas (por mí, a tu pedido)

- Precio de Manoo Pro: **$29 USD/año** confirmado, se queda como está en la página.
- Solicitante de la marca ante IMPI: **Corporación Jamiel** (persona moral), no Jamiel como persona física — ver `TRADEMARK_IMPI_BORRADOR.md`.

## 🔴 Esto sí lo necesito de ti — no lo puedo decidir ni adivinar

**Tu usuario de GitHub.** Sin esto no puedo dejar listo el push que hace público el plugin, la página en GitHub Pages, ni el subdominio `manoo.is-a.dev`. Es el único bloqueo real que queda.
