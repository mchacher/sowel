import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SettingsManager } from "./settings-manager.js";

describe("SettingsManager.getZ2mConfig", () => {
  let settings: SettingsManager;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    settings = new SettingsManager(db);
  });

  const setTopic = (value: string): void =>
    settings.set("integration.zigbee2mqtt.base_topic", value);

  it("defaults to the single zigbee2mqtt topic when unset", () => {
    expect(settings.getZ2mConfig()).toEqual({
      baseTopic: "zigbee2mqtt",
      baseTopics: ["zigbee2mqtt"],
    });
  });

  it("reads a single configured topic", () => {
    setTopic("z2m_home");
    expect(settings.getZ2mConfig()).toEqual({ baseTopic: "z2m_home", baseTopics: ["z2m_home"] });
  });

  it("splits the list of one Zigbee2MQTT instance per coordinator", () => {
    setTopic("zigbee2mqtt, zigbee2mqtt_annex ,zigbee2mqtt_garage");
    expect(settings.getZ2mConfig()).toEqual({
      baseTopic: "zigbee2mqtt",
      baseTopics: ["zigbee2mqtt", "zigbee2mqtt_annex", "zigbee2mqtt_garage"],
    });
  });

  it("keeps only the topic part of a topic:prefix entry", () => {
    setTopic("zigbee2mqtt, zigbee2mqtt_annex:annex, zigbee2mqtt_garage:");
    expect(settings.getZ2mConfig().baseTopics).toEqual([
      "zigbee2mqtt",
      "zigbee2mqtt_annex",
      "zigbee2mqtt_garage",
    ]);
  });

  it("drops blanks, duplicates and trailing slashes rather than yielding an empty topic", () => {
    setTopic(" , zigbee2mqtt/ , zigbee2mqtt, ,zigbee2mqtt_annex");
    expect(settings.getZ2mConfig()).toEqual({
      baseTopic: "zigbee2mqtt",
      baseTopics: ["zigbee2mqtt", "zigbee2mqtt_annex"],
    });
  });

  it("falls back to the default when the setting holds only separators", () => {
    setTopic(" , , ");
    expect(settings.getZ2mConfig()).toEqual({
      baseTopic: "zigbee2mqtt",
      baseTopics: ["zigbee2mqtt"],
    });
  });
});
