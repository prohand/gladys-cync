# Cync

This integration connects Gladys to your **Cync** account (formerly **C by
GE**, GE Lighting): bulbs, light strips, downlights, wall switches and dimmers,
smart plugs and the fan controller you set up in the Cync app.

## Before you start

- Your devices are set up in the **Cync mobile app**, not in Gladys. Check they
  work there first.
- Each home needs **at least one Cync device with Wi-Fi** that stays powered: a
  Wi-Fi bulb, a plug, a switch. Bluetooth-only bulbs are reached through it.
- Gladys needs internet access: Cync devices are driven **through the Cync
  cloud** (see [Cloud only](#cloud-only)).

## Configuration

| Field                            | What to enter                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| **Cync account email**           | The email you sign in to the Cync app with.                                                   |
| **Cync account password**        | Its password. Stored by Gladys as a secret, never written in the logs.                        |
| **Add the Cync rooms as lights** | On by default: every room of the Cync app also becomes a light in Gladys (see below).         |
| **Full state read (s)**          | 300 by default. Changes arrive instantly anyway; this read catches devices that went offline. |
| **Detailed logs**                | Off by default. Turn it on only to diagnose a device: every frame is logged.                  |

## Signing in: the verification code

Cync usually protects the account with a code sent by email. Signing in takes
three clicks, once:

1. Fill in the email and the password, then **Save**. The status says that a
   code is required.
2. Click **Send a verification code**. Cync emails a code to the account
   address.
3. Click **Validate the code**, type the code, confirm.

The answer says how many devices were found, and the status turns
**connected**. The integration then keeps its session in its own storage: a
restart of Gladys or of the integration does **not** ask for a new code.

A new code is only needed if you change the email, or if Cync ends the session
(after a password change, for example). The status says so.

## Devices

After signing in, open the **Discovery** tab of the integration and add the
devices you want.

| Cync device                   | In Gladys                                                       |
| ----------------------------- | --------------------------------------------------------------- |
| Bulb, strip, downlight        | Light: on/off, brightness, white, color — as the model supports |
| Wall switch / dimmer          | Light: on/off (and brightness for a dimmer)                     |
| Switch with motion sensor     | Light, plus a **motion sensor**                                 |
| Plug, outdoor two-outlet plug | Switch (one device per outlet)                                  |
| Fan controller                | Switch: on/off and speed (0–100 %)                              |
| Room or group of the Cync app | Light: drives all its lights at once                            |

The **white temperature** goes from 2000 K (warm) to 7000 K (cool).

Cameras, thermostats and other Cync products are not supported: they are left
out, and the logs name them.

### Rooms

A room switches all its lights **with one order**: they turn on together,
instead of one after the other. A room only offers what **all** its lights can
do: a room mixing color and white bulbs has no color setting. It shows as on
when at least one of its lights is on.

A room without any light (plugs only) is not added. Turn **Add the Cync rooms
as lights** off if you do not want rooms at all.

### The connection badge

Every Cync device shows a **cloud** badge while the Cync cloud reaches it, and
**unreachable** when it does not: the device is unpowered, out of range of the
other devices, or the integration lost the cloud.

## Actions

On the integration page:

- **Send a verification code** / **Validate the code**: the sign-in above.
- **Test the connection**: reads every state now and answers with the number
  of devices online, and of homes that have a Wi-Fi relay.
- **Reload the device list**: reads the homes again from the Cync cloud, after
  adding, renaming or moving a device in the Cync app.

## Scenes and dashboard (Gladys 5.1+)

### Scene triggers

- **A Cync sensor detects motion**: fired once per detection by a switch or
  sensor with a motion sensor. Filter on the sensor, or leave it empty for all.
- **A Cync device goes offline or online**: the Cync mesh stops hearing a
  device (power cut, wall switch turned off) or hears it again. Filter on the
  device and on the change; the following actions read the change in the
  `status` variable (`online` or `offline`).

### Scene actions

- **Set a Cync light in one go**: power, brightness and white temperature in a
  **single** order. A light turned on this way goes straight to the target,
  without first flashing at its previous setting. Works for rooms too. Its
  output **Order sent** is false when the light could not be reached: use it as
  a condition if the rest of the scene depends on it.
- **Read the Cync states now**: asks every home for the state of its devices.
  Outputs: **Devices online** and **Devices in total**.

### Widgets

- **Cync status**: the cloud connection, the devices online, the Wi-Fi relay of
  each home, and two buttons: **Read states** and **Reload devices**.
- **Cync devices**: one line per device: on (with its brightness), off, or
  offline. The **Show** setting limits it to the devices on, or to the offline
  ones — handy after a power cut.

## Good to know

### Cloud only

Cync devices have no local API: the Cync app itself drives them through the
Cync cloud. The integration does the same, over one permanent connection:

- your orders go to the cloud, which hands them to a **Wi-Fi device of your
  home** (the "relay"), which passes them to the other devices over Bluetooth;
- every change — from Gladys, the Cync app, a wall switch, a voice assistant —
  comes back the same way, within a second.

So without internet, or with the Cync cloud down, Gladys can no longer drive
the devices. The integration reconnects by itself as soon as possible.

### The Cync server certificate

The Cync server presents an expired certificate whose name does not match.
The integration tries a strict check first; when it fails, it connects anyway,
like the Cync app does, and writes a warning in the logs. The traffic stays
encrypted.

### What is stored

The integration stores its Cync session (tokens, not the password) in its own
storage, readable by the integration only. The password stays in the Gladys
configuration.

## Troubleshooting

| Symptom                                   | What to check                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "Code required" again and again           | Use **Send a verification code**, then **Validate the code** with the latest code: a code expires quickly.        |
| "The Cync cloud refused this code"        | Wrong or expired code, or wrong password: check the password, ask for a new code.                                 |
| All the devices of a home are unreachable | No Wi-Fi Cync device of that home is online. Power one on; **Test the connection** shows the homes without relay. |
| One device is unreachable                 | It is unpowered (wall switch off?) or too far from the others. The Cync app shows the same.                       |
| A new device does not appear              | **Reload the device list**, then the **Discovery** tab.                                                           |
| A device does not react, the others do    | Turn **Detailed logs** on, try again, and look at the integration logs (frames sent and received).                |
