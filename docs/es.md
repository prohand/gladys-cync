# Cync

Esta integración conecta Gladys con su cuenta **Cync** (antes **C by GE**, GE
Lighting): bombillas, tiras LED, focos empotrados, interruptores y reguladores
de pared, enchufes inteligentes y el controlador de ventilador configurados en
la aplicación Cync.

## Antes de empezar

- Sus dispositivos se configuran en la **aplicación móvil Cync**, no en Gladys.
  Compruebe primero que funcionan allí.
- Cada hogar necesita **al menos un dispositivo Cync con Wi-Fi** siempre
  alimentado: una bombilla Wi-Fi, un enchufe, un interruptor. Las bombillas
  solo Bluetooth se alcanzan a través de él.
- Gladys necesita acceso a internet: los dispositivos Cync se controlan **a
  través de la nube Cync** (vea [Solo nube](#solo-nube)).

## Configuración

| Campo                                    | Qué introducir                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Correo de la cuenta Cync**             | El correo con el que inicia sesión en la aplicación Cync.                                                            |
| **Contraseña de la cuenta Cync**         | Su contraseña. Gladys la guarda como secreto y nunca se escribe en los registros.                                    |
| **Añadir las estancias Cync como luces** | Activado por defecto: cada estancia de la aplicación Cync se convierte también en una luz en Gladys (ver más abajo). |
| **Lectura completa de estados (s)**      | 300 por defecto. Los cambios llegan al instante; esta lectura detecta los dispositivos desconectados.                |
| **Registros detallados**                 | Desactivado por defecto. Actívelo solo para diagnosticar un dispositivo: se registra cada trama.                     |

## Inicio de sesión: el código de verificación

Cync suele proteger la cuenta con un código enviado por correo. El inicio de
sesión se hace en tres clics, una sola vez:

1. Introduzca el correo y la contraseña y pulse **Guardar**. El estado indica
   que se necesita un código.
2. Pulse **Enviar un código de verificación**. Cync envía un código a la
   dirección de la cuenta.
3. Pulse **Validar el código**, escriba el código y confirme.

La respuesta indica cuántos dispositivos se han encontrado, y el estado pasa a
**conectado**. Después, la integración guarda su sesión en su propio
almacenamiento: reiniciar Gladys o la integración **no** pide un código nuevo.

Solo hace falta un código nuevo si cambia el correo, o si Cync cierra la sesión
(tras un cambio de contraseña, por ejemplo). El estado lo indica.

## Dispositivos

Tras iniciar sesión, abra la pestaña **Descubrimiento** de la integración y
añada los dispositivos que quiera.

| Dispositivo Cync                       | En Gladys                                                       |
| -------------------------------------- | --------------------------------------------------------------- |
| Bombilla, tira, foco empotrado         | Luz: encendido/apagado, brillo, blanco, color — según el modelo |
| Interruptor / regulador de pared       | Luz: encendido/apagado (y brillo en un regulador)               |
| Interruptor con detector de movimiento | Luz, más un **sensor de movimiento**                            |
| Enchufe, enchufe exterior doble        | Interruptor (un dispositivo por toma)                           |
| Controlador de ventilador              | Interruptor: encendido/apagado y velocidad (0–100 %)            |
| Estancia o grupo de la aplicación Cync | Luz: controla todas sus luces a la vez                          |

La **temperatura del blanco** va de 2000 K (cálido) a 7000 K (frío).

Las cámaras, termostatos y otros productos Cync no son compatibles: se omiten,
y los registros los nombran.

### Las estancias

Una estancia controla todas sus luces **con una sola orden**: se encienden
juntas, en lugar de una tras otra. Una estancia solo ofrece lo que **todas**
sus luces pueden hacer: una estancia que mezcla bombillas de color y blancas no
tiene ajuste de color. Aparece encendida en cuanto una de sus luces lo está.

Una estancia sin luces (solo enchufes) no se añade. Desactive **Añadir las
estancias Cync como luces** si no quiere ninguna estancia.

### La insignia de conexión

Cada dispositivo Cync muestra una insignia **nube** mientras la nube Cync lo
alcanza, e **inaccesible** si no: el dispositivo no tiene alimentación, está
fuera del alcance de los demás, o la integración ha perdido la nube.

## Acciones

En la página de la integración:

- **Enviar un código de verificación** / **Validar el código**: el inicio de
  sesión descrito arriba.
- **Probar la conexión**: lee todos los estados al momento y responde con el
  número de dispositivos en línea y de hogares con un relé Wi-Fi.
- **Recargar la lista de dispositivos**: vuelve a leer los hogares desde la nube
  Cync, tras añadir, renombrar o mover un dispositivo en la aplicación Cync.

## Escenas y panel (Gladys 5.1+)

### Disparadores de escena

- **Un sensor Cync detecta movimiento**: se activa una vez por detección de un
  interruptor o sensor con detector de movimiento. Filtre por el sensor, o
  déjelo vacío para todos.
- **Un dispositivo Cync se desconecta o se conecta**: la malla Cync deja de oír
  un dispositivo (corte de corriente, interruptor de pared apagado) o lo vuelve
  a oír. Filtre por el dispositivo y por el cambio; las acciones siguientes
  leen el cambio en la variable `status` (`online` u `offline`).

### Acciones de escena

- **Ajustar una luz Cync de una vez**: encendido, brillo y temperatura del
  blanco en una **sola** orden. Una luz encendida así va directamente al ajuste
  deseado, sin destellar antes con su ajuste anterior. También funciona con
  estancias. Su salida **Orden enviada** es falsa cuando no se pudo alcanzar la
  luz: úsela como condición si el resto de la escena depende de ello.
- **Leer los estados Cync ahora**: pide a cada hogar el estado de sus
  dispositivos. Salidas: **Dispositivos en línea** y **Dispositivos en total**.

### Widgets

- **Estado Cync**: la conexión a la nube, los dispositivos en línea, el relé
  Wi-Fi de cada hogar y dos botones: **Leer estados** y **Recargar**.
- **Dispositivos Cync**: una línea por dispositivo: encendido (con su brillo),
  apagado o sin conexión. El ajuste **Mostrar** la limita a los dispositivos
  encendidos, o a los desconectados — útil tras un corte de corriente.

## Conviene saber

### Solo nube

Los dispositivos Cync no tienen API local: la propia aplicación Cync los
controla a través de la nube Cync. La integración hace lo mismo, con una
conexión permanente:

- sus órdenes van a la nube, que las entrega a un **dispositivo Wi-Fi de su
  hogar** (el «relé»), que las transmite a los demás por Bluetooth;
- cada cambio — desde Gladys, la aplicación Cync, un interruptor de pared o un
  asistente de voz — vuelve por el mismo camino, en menos de un segundo.

Sin internet, o con la nube Cync caída, Gladys ya no puede controlar los
dispositivos. La integración se reconecta sola en cuanto es posible.

### El certificado del servidor Cync

El servidor Cync presenta un certificado caducado cuyo nombre no coincide. La
integración intenta primero una verificación estricta; si falla, se conecta de
todos modos, como la aplicación Cync, y escribe una advertencia en los
registros. El tráfico sigue cifrado.

### Qué se guarda

La integración guarda su sesión Cync (tokens, no la contraseña) en su propio
almacenamiento, que solo ella puede leer. La contraseña se queda en la
configuración de Gladys.

## Solución de problemas

| Síntoma                                               | Qué comprobar                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| «Código necesario» una y otra vez                     | Use **Enviar un código de verificación** y luego **Validar el código** con el último código: un código caduca pronto.            |
| «La nube Cync ha rechazado este código»               | Código erróneo o caducado, o contraseña incorrecta: compruebe la contraseña y pida un código nuevo.                              |
| Todos los dispositivos de un hogar están inaccesibles | Ningún dispositivo Cync Wi-Fi de ese hogar está en línea. Encienda uno; **Probar la conexión** muestra los hogares sin relé.     |
| Un dispositivo está inaccesible                       | No tiene alimentación (¿interruptor de pared apagado?) o está demasiado lejos de los demás. La aplicación Cync muestra lo mismo. |
| Un dispositivo nuevo no aparece                       | **Recargar la lista de dispositivos** y luego la pestaña **Descubrimiento**.                                                     |
| Un dispositivo no responde, los demás sí              | Active **Registros detallados**, vuelva a intentarlo y mire los registros de la integración (tramas enviadas y recibidas).       |
