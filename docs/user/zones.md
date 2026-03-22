# Zones

Zones represent the **spatial structure** of your home. They organize your equipments into rooms, floors, and areas -- and they automatically compute real-time status for each space.

## Creating zones

Go to **Administration > Zones**.

### Building your zone tree

Zones form a hierarchy (tree structure). A typical setup:

```
Home
  Ground Floor
    Living Room
    Kitchen
    Hallway
    Bathroom
  First Floor
    Master Bedroom
    Kids Room
    Office
  Outdoor
    Garden
    Terrace
    Garage
```

To create a zone:

1. Click **Add Zone**
2. Enter a name
3. Select a parent zone (or none for a root zone)

You can nest zones to any depth, but 2--3 levels is usually enough (Home > Floor > Room).

### Reordering zones

Zones have a display order that controls how they appear in the sidebar. You can reorder zones within the same parent by dragging them in the zone list.

### Editing and deleting

- Click a zone to edit its name or move it to a different parent
- Delete removes the zone and **unassigns** its equipments (they are not deleted)

!!! warning
You cannot delete a zone that has child zones. Delete or move the children first.

## Zone aggregation

This is one of Sowel's most powerful features. Every zone automatically computes **aggregated data** from the equipments it contains. No configuration needed.

### What gets aggregated

| Data                         | Logic                                | Example                              |
| ---------------------------- | ------------------------------------ | ------------------------------------ |
| **Temperature**              | Average of all temperature sensors   | 21.5 C (avg of 2 Aqara sensors)      |
| **Humidity**                 | Average of all humidity sensors      | 45%                                  |
| **Luminosity**               | Average of all light sensors         | 320 lx                               |
| **Motion**                   | OR across all motion sensors         | "Motion" if any PIR detects presence |
| **Motion duration**          | Time since last motion state change  | "Calm for 15 min"                    |
| **Lights on**                | Count of active lights               | 2 / 5 lights on                      |
| **Shutters open**            | Count of open shutters               | 1 / 3 shutters open                  |
| **Average shutter position** | Average position across all shutters | 65%                                  |
| **Open doors**               | Count of open door contacts          | 1 door open                          |
| **Open windows**             | Count of open window contacts        | 2 windows open                       |
| **Water leak**               | OR across all water leak sensors     | Alert if any sensor detects water    |
| **Smoke**                    | OR across all smoke sensors          | Alert if any sensor detects smoke    |

### Recursive aggregation

Aggregation is **recursive**: a parent zone automatically merges data from all its child zones.

**Example**: The "First Floor" zone aggregates data from Master Bedroom, Kids Room, and Office. If there is motion in any of those rooms, the First Floor shows "Motion". The temperature shown is the average across all three rooms.

This means you can glance at a floor-level zone and know the overall status without checking each room individually.

### How it appears in the UI

In the **Home** view, each zone displays a **status header** with aggregated data shown as colored pills:

- **Temperature** pill (e.g., "21.5 C")
- **Humidity** pill (e.g., "45%")
- **Motion** pill with duration ("Motion" or "Calm 15min")
- **Lights** count pill (e.g., "2/5")
- **Shutters** count pill (e.g., "1/3")
- **Alert** pills for open doors/windows, water leaks, smoke

Below the header, equipments are grouped by type (Lights, Shutters, Sensors) with inline controls.

## Zone orders

Each zone exposes automatic orders that you can use from the UI or in automations:

| Order              | Effect                                                 |
| ------------------ | ------------------------------------------------------ |
| **All Off**        | Turns off all equipments in the zone (and child zones) |
| **All Lights Off** | Turns off all light equipments in the zone             |
| **All Lights On**  | Turns on all light equipments in the zone              |

These are available in the Home view, in the API, and as actions in recipes and modes.

## Tips

- **Match your physical layout**: Zones should reflect how you think about your home. If you say "the living room", that should be a zone.
- **Don't over-nest**: Two or three levels (Home > Floor > Room) is usually enough. Deeply nested trees are harder to navigate.
- **Outdoor zones**: Create an "Outdoor" zone for garden sensors, gate, and any exterior equipment.
- **Aggregation drives value**: The more sensors and equipments you assign to zones, the richer the aggregated status becomes. Even a single temperature sensor in a room makes the zone header useful.
