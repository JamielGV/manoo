# Manual de usuario — Manoo

Manoo le da manos a Claude Code: puede ver tu pantalla y mover el mouse y
el teclado por sí mismo, en vez de solo decirte qué hacer. Todo corre en tu
propia computadora — nada de lo que Manoo ve o hace se envía a ningún
lado, excepto a Claude mismo (igual que cualquier archivo que Claude lee
en una sesión normal).

## Requisitos

- Linux con X11, o macOS (soporte de macOS recién agregado y aún sin
  probar en una Mac real - el control de ventanas podría fallar).
  Windows: el mouse/teclado/screenshot funcionan, pero listar/enfocar/
  dividir ventanas todavía no. Linux con Wayland tampoco funciona todavía.
- Claude Code instalado.
- Node.js (para correr el servidor de Manoo).

## Instalación

```bash
claude plugin marketplace add https://github.com/JamielGV/manoo
claude plugin install manoo@manoo-local
```

No necesitas clonar el repositorio tú mismo ni instalar nada aparte —
Claude Code descarga el plugin e instala sus dependencias solo. Usa la
URL completa con `https://` (no la forma corta `usuario/repo`) para que
funcione aunque no tengas una llave SSH configurada con GitHub.

Reinicia tu sesión de Claude Code después de instalar. Desde ese momento,
en cualquier conversación puedes pedirle a Claude que actúe directamente
sobre tu pantalla — por ejemplo: *"abre el navegador y busca X"*, *"haz
clic en el botón de guardar"*, *"revisa qué dice esa ventana"*.

No necesitas invocar nada especial: si le pides a Claude que haga algo en
pantalla en vez de solo explicártelo, Claude usa Manoo automáticamente.

### Permisos que debes dar en macOS antes de usar Manoo

En macOS, el sistema operativo exige que apruebes manualmente varios
permisos de privacidad para la app que corre tu sesión de Claude Code
(Terminal, iTerm, la IDE que uses, etc. — la que realmente ejecuta el
proceso del servidor de Manoo). Sin ellos, las acciones de Manoo fallan
en silencio o macOS ni siquiera muestra el diálogo de permiso. Otórgalos
desde **Ajustes del Sistema > Privacidad y Seguridad**, buscando esa app
en cada una de estas categorías y activando su casilla:

1. **Accesibilidad** — para que Manoo pueda mover el mouse y escribir de
   verdad, y para que pueda listar, enfocar, mover y dividir ventanas.
2. **Grabación de pantalla** — para que Manoo pueda tomar capturas de tu
   pantalla y así saber qué hay antes de actuar.
3. **Monitoreo de entrada** — para que el botón de emergencia funcione:
   Manoo necesita poder detectar cuándo tú tocas el mouse o el teclado de
   verdad, en cualquier ventana, para detenerse al instante.
4. **Automatización** — la primera vez que Manoo intente organizar
   ventanas, macOS te pedirá autorizar que esa app controle "Eventos del
   sistema" (System Events); acepta ese diálogo cuando aparezca.

Si ya usaste Manoo y algo (mover el mouse, tomar una captura, detectar el
botón de emergencia) no está funcionando, revisa primero que estos cuatro
permisos sigan activos — macOS a veces los desactiva solos tras una
actualización del sistema.

## Qué verás mientras Manoo trabaja

- **La pantalla se divide sola:** el IDE con la conversación de Claude
  Code queda visible en una mitad de la pantalla, y la aplicación que
  Manoo está usando en la otra — nunca pierdes de vista lo que Claude está
  pensando/diciendo mientras actúa.
- **El cursor del mouse brilla en neón mientras Manoo actúa:** en cuanto
  Manoo mueve el mouse o escribe, el cursor se ve como una mano
  brillante, y regresa a la normalidad a los pocos segundos de que Manoo
  termina — así siempre sabes, de un vistazo, si el mouse se está
  moviendo solo o lo estás moviendo tú. (En Linux esto reemplaza el
  cursor real del sistema; en macOS es una superposición que sigue al
  cursor real — el efecto visual es el mismo.)

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
| Precio | $0 | $49 USD/año o $6 USD/mes |

Si llegas al límite de 25 acciones, Claude te lo dirá claramente con un
mensaje — no necesitas hacer nada más que activar una licencia Pro para
seguir.

### Comprar Manoo Pro

Entra a [jamielgv.github.io/manoo](https://jamielgv.github.io/manoo/) y
dale clic a "Obtener Pro" (puedes elegir anual o mensual) — el pago se
procesa con Stripe, y tu clave de licencia te llega automáticamente por
correo en cuanto se confirma el pago, sin que nadie tenga que hacer nada
manual.

### Activar Manoo Pro

Una vez que tengas tu clave de licencia (por correo tras tu compra, o
directo de Corporación Jamiel si compraste de otra forma), simplemente
pídele a Claude:

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
En macOS sí — control de ventanas (listar/enfocar/dividir pantalla) y
cursor neón ya confirmados en hardware real, con captura de pantalla
real de por medio para el cursor. El cursor neón en macOS corre de
forma distinta que en Linux (una superposición que sigue al cursor
real, en vez de reemplazar el cursor del sistema) pero se ve igual.
Sigue siendo más nuevo que la versión de Linux — si notas algo raro
(varios monitores, apps en pantalla completa), avísanos. En Windows, el
mouse/teclado/captura de pantalla ya funcionan, pero el control de
ventanas y el cursor neón todavía no se han implementado. Si usas Linux
con Wayland (por ejemplo, Ubuntu reciente por defecto), tampoco funciona
aún.

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
