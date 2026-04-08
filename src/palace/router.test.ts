import { describe, it, expect } from "bun:test";
import {
  wingFromAgent,
  diaryWing,
  slugifyRoom,
  routeToAddress,
  PalaceAddress,
} from "./router";

describe("router", () => {
  describe("wingFromAgent", () => {
    it("should derive wing from agentId", () => {
      expect(wingFromAgent("secretarius")).toBe("wing_secretarius");
    });

    it("should handle nova", () => {
      expect(wingFromAgent("nova")).toBe("wing_nova");
    });

    it("should return wing_general for empty agentId", () => {
      expect(wingFromAgent("")).toBe("wing_general");
    });

    it("should trim whitespace", () => {
      expect(wingFromAgent("  meridian  ")).toBe("wing_meridian");
    });

    it("should handle augur", () => {
      expect(wingFromAgent("augur")).toBe("wing_augur");
    });
  });

  describe("diaryWing", () => {
    it("should derive diary wing from agentId", () => {
      expect(diaryWing("meridian")).toBe("wing_diary_meridian");
    });

    it("should return wing_diary_general for empty agentId", () => {
      expect(diaryWing("")).toBe("wing_diary_general");
    });

    it("should handle secretarius", () => {
      expect(diaryWing("secretarius")).toBe("wing_diary_secretarius");
    });

    it("should trim whitespace", () => {
      expect(diaryWing("  augur  ")).toBe("wing_diary_augur");
    });
  });

  describe("slugifyRoom", () => {
    it("should slugify room hint", () => {
      expect(slugifyRoom("Auth Migration 2026")).toBe("auth-migration-2026");
    });

    it("should handle spaces and special chars", () => {
      expect(slugifyRoom("  spaces!@#  ")).toBe("spaces");
    });

    it("should convert to lowercase", () => {
      expect(slugifyRoom("Auth MIGRATION")).toBe("auth-migration");
    });

    it("should replace spaces with hyphens", () => {
      expect(slugifyRoom("Regime Fade")).toBe("regime-fade");
    });

    it("should strip leading and trailing hyphens", () => {
      expect(slugifyRoom("  foo-bar  ")).toBe("foo-bar");
    });

    it("should collapse multiple spaces into single hyphen", () => {
      expect(slugifyRoom("foo    bar")).toBe("foo-bar");
    });

    it("should handle empty string", () => {
      expect(slugifyRoom("")).toBe("");
    });

    it("should collapse multiple hyphens", () => {
      expect(slugifyRoom("foo---bar")).toBe("foo-bar");
    });

    it("should strip special characters", () => {
      expect(slugifyRoom("foo!@#$%bar")).toBe("foobar");
    });
  });

  describe("routeToAddress", () => {
    it("should route to diary address when isDiary is true", () => {
      const result = routeToAddress("secretarius", { isDiary: true });
      expect(result).toEqual({
        wing: "wing_diary_secretarius",
        room: "diary",
      });
    });

    it("should route to room hint when roomHint is provided", () => {
      const result = routeToAddress("meridian", { roomHint: "Regime Fade" });
      expect(result).toEqual({
        wing: "wing_meridian",
        room: "regime-fade",
      });
    });

    it("should default to general room", () => {
      const result = routeToAddress("augur");
      expect(result).toEqual({
        wing: "wing_augur",
        room: "general",
      });
    });

    it("should handle empty agentId", () => {
      const result = routeToAddress("");
      expect(result).toEqual({
        wing: "wing_general",
        room: "general",
      });
    });

    it("should prioritize isDiary over roomHint", () => {
      const result = routeToAddress("nova", {
        isDiary: true,
        roomHint: "Some Room",
      });
      expect(result).toEqual({
        wing: "wing_diary_nova",
        room: "diary",
      });
    });

    it("should slugify room hint", () => {
      const result = routeToAddress("secretarius", {
        roomHint: "Auth Migration 2026",
      });
      expect(result).toEqual({
        wing: "wing_secretarius",
        room: "auth-migration-2026",
      });
    });

    it("should handle all known agents", () => {
      const agents = [
        "secretarius",
        "meridian",
        "augur",
        "consul",
        "nova",
        "plex",
        "qwen-sage",
        "sakan",
        "main",
      ];

      agents.forEach((agent) => {
        const result = routeToAddress(agent);
        expect(result.wing).toBe(`wing_${agent}`);
        expect(result.room).toBe("general");
      });
    });
  });
});
