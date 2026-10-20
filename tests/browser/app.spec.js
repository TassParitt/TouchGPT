import { test, expect } from "@playwright/test";
test("mobile navigation, sample results, local history, export and mode switch", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Feel a little deeper." }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  for (const name of ["Hardness", "Density", "Texture"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page
    .getByRole("button", { name: "Try a sample measurement", exact: false })
    .click();
  await expect(page.getByText("SAMPLE DATA", { exact: true })).toBeVisible();
  await expect(page.locator(".big-result")).toContainText("+38%");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "History" })
    .click();
  await expect(page.getByText("Woven cotton", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "History" })
    .click();
  await page.getByRole("button", { name: /Woven cotton.*Texture/ }).click();
  await page.getByRole("button", { name: "Download results" }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download JSON/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox").selectOption("legacy");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /Try a sample measurement/ }).click();
  await expect(page.locator(".big-result")).toContainText("/ 10");
  expect(errors).toEqual([]);
});
test("real Web Audio capture with a synthetic microphone saves a persistent baseline", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Set up calibration" }).click();
  await page
    .getByRole("button", { name: "Record baseline", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel calibration" }),
  ).toBeVisible();
  await expect(page.getByText("Baseline active", { exact: false })).toBeVisible(
    { timeout: 15000 },
  );
  await page.reload();
  await expect(
    page.getByText("Baseline active", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("What are you exploring?").fill("Test fabric");
  await page.getByRole("button", { name: "Start measurement" }).click();
  await expect(page.getByText("CAPTURE COMPLETE", { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  await expect(page.locator(".big-result")).toContainText("%");
  await page.getByText("IMU physics metadata", { exact: true }).click();
  await expect(page.getByText("No — unvalidated")).toBeVisible();
});
test("microphone refusal produces an actionable error and releases recording state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException(
        "Microphone permission denied.",
        "NotAllowedError",
      );
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Set up calibration" }).click();
  await page
    .getByRole("button", { name: "Record baseline", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone permission denied",
  );
  await expect(
    page.getByRole("button", { name: "Record baseline", exact: true }),
  ).toBeEnabled();
});
test("offline shell loads after the production service worker is activated", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Feel a little deeper." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Try a sample measurement/ }).click();
  await expect(page.getByText("SAMPLE DATA", { exact: true })).toBeVisible();
});
test("photo upload, cloud account, upload and retrieval work together", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept="image/*"]')
    .last()
    .setInputFiles("public/icon-192.png");
  await expect(page.getByAltText("Object preview")).toBeVisible();
  await page.getByLabel("What are you exploring?").fill("Photo object");
  await page.getByRole("button", { name: /Try a sample measurement/ }).click();
  await page
    .getByRole("button", { name: "Upload to cloud", exact: true })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("safe-testing-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Upload result", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Uploaded");
  await page
    .locator(".mobile-nav")
    .getByRole("button", { name: "History" })
    .click();
  await page.getByRole("button", { name: "Open cloud library" }).click();
  await page.getByRole("button", { name: /Photo object.*texture/ }).click();
  await expect(
    page.getByRole("heading", { name: "Photo object", exact: true }),
  ).toBeVisible();
  await expect(page.getByAltText("Photo object")).toBeVisible();
});
test("cancelling recalibration preserves the original baseline", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "TouchGPT_v6_baseline",
      JSON.stringify({
        texture: {
          label: "Original reference",
          features: { value: 1200 },
          timestamp: "2026-01-01T00:00:00Z",
          id: "old",
        },
      }),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Manage calibration" }).click();
  await page
    .getByRole("button", { name: "Re-calibrate baseline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record new baseline", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel calibration" }).click();
  await expect(
    page.getByRole("button", { name: "Re-calibrate baseline", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("TouchGPT_v6_baseline")).texture.id,
    ),
  ).toBe("old");
});
test("unsupported vibration cannot produce a density result", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Density", exact: true }).click();
  await page.getByRole("button", { name: "Set up calibration" }).click();
  await page
    .getByRole("button", { name: "Record baseline", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "cannot control the vibration motor",
  );
  await expect(page.getByText("CAPTURE COMPLETE", { exact: true })).toHaveCount(
    0,
  );
});
