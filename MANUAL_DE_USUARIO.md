# Manual de usuario — Manoo

Manoo le da manos a Claude Code: puede ver tu pantalla y mover el mouse y
el teclado por sí mismo, en vez de solo decirte qué hacer. Todo corre en tu
propia computadora — nada de lo que Manoo ve o hace se envía a ningún
lado, excepto a Claude mismo (igual que cualquier archivo que Claude lee
en una sesión normal).

## Requisitos

- Linux con X11 (no funciona todavía en Wayland ni en macOS/Windows).
- Claude Code instalado.
- Node.js (para correr el servidor de Manoo).

## Instalación

```bash
claude plugin marketplace add ruta/a/manoo
claude plugin install manoo@manoo-local
```

Reinicia tu sesión de Claude Code después de instalar. Desde ese momento,
en cualquier conversación puedes pedirle a Claude que actúe directamente
sobre tu pantalla — por ejemplo: *"abre el navegador y busca X"*, *"haz
clic en el botón de guardar"*, *"revisa qué dice esa ventana"*.

No necesitas invocar nada especial: si le pides a Claude que haga algo en
pantalla en vez de solo explicártelo, Claude usa Manoo automáticamente.

## Qué verás mientras Manoo trabaja

- **La pantalla se divide sola:** el IDE con la conversación de Claude
  Code queda visible en una mitad de la pantalla, y la aplicación que
  Manoo está usando en la otra — nunca pierdes de vista lo que Claude está
  pensando/diciendo mientras actúa.
- **Un HUD neon en la esquina:** una ventanita con un punto que sigue al
  mouse y un texto que destella con lo último que se escribió o qué tecla
  se presionó — para que veas de un vistazo que Manoo está trabajando.

## El botón de emergencia: tú siempre tienes el control

Manoo vigila el mouse y el teclado de **todo el sistema**, desde cualquier
dispositivo. Si tocas el mouse o el teclado de verdad mientras Manoo está
actuando, se detiene de inmediato — no adivina qué querías hacer, para y
te avisa con un mensaje que empieza con 🛑. Simplemente vuelve a pedirle
que continúe cuando quieras.

Esto es a propósito **para todo el sistema**, no solo para la ventana que
Manoo está usando — si tocas cualquier cosa en cualquier ventana mientras
Manoo actúa, se detiene. Preferimos que se detenga de más a que actúe
cuando no debía.

## Niveles: Free y Pro

| | Free | Pro |
|---|---|---|
| Acciones | 25 por sesión | Ilimitadas |
| Registro de auditoría local | No | Sí (`~/.local/share/manoo/audit.log`) |
| Precio | $0 | $29 USD/año |

Si llegas al límite de 25 acciones, Claude te lo dirá claramente con un
mensaje — no necesitas hacer nada más que activar una licencia Pro para
seguir.

### Activar Manoo Pro

Una vez que tengas tu clave de licencia (te la manda Corporación Jamiel
después de tu pago), simplemente pídele a Claude:

> Activa mi licencia de Manoo con esta clave: `<tu-clave>`

Claude usará la herramienta `license_activate` y quedará guardada para
siempre en `~/.config/manoo/license.key` — no necesitas repetir esto en
cada sesión.

Para revisar tu estado en cualquier momento, pídele a Claude: *"¿cuál es
mi estado de licencia de Manoo?"*.

## Reglas de seguridad (Manoo las sigue siempre)

- **Nunca escribe en campos de contraseña.** Si un campo parece ser de
  contraseña, PIN o token, Manoo se detiene y te pide que lo escribas tú.
- **Confirma antes de acciones destructivas o irreversibles** — borrar,
  enviar un pago, mandar un mensaje, cerrar sin guardar.
- **Solo actúa dentro de lo que le pediste** — no explora ventanas o
  aplicaciones que no mencionaste.

## Preguntas frecuentes

**¿Funciona en macOS o Windows?**
No todavía — es un prototipo para Linux/X11. Si usas Wayland (por ejemplo,
Ubuntu reciente por defecto), tampoco funciona aún.

**¿Qué pasa si muevo el mouse sin querer mientras Manoo actúa?**
Se detiene la siguiente acción y Claude te avisa. Vuelve a pedirle que
continúe cuando quieras — no perdiste nada, solo se pausó.

**¿Manoo manda mis pantallazos a algún lado?**
No. Todo corre localmente. Ni siquiera el registro de auditoría de Pro
sale de tu máquina.

**¿Cómo dejo de usar Manoo?**

```bash
claude plugin uninstall manoo@manoo-local
```

## Soporte

Corporación Jamiel — jamiel.garcia.velazquez@gmail.com
