export function validRecord(r) {
  return (
    r &&
    typeof r.id === "string" &&
    /^[\w-]{1,80}$/.test(r.id) &&
    typeof r.label === "string" &&
    r.label.length > 0 &&
    r.label.length <= 120 &&
    ["texture", "hardness", "density"].includes(r.type) &&
    ["relative", "legacy"].includes(r.mode) &&
    typeof r.demo === "boolean" &&
    Number.isFinite(r.features?.value) &&
    r.features.value > 0 &&
    r.imu &&
    typeof r.imu === "object" &&
    typeof r.createdAt === "string" &&
    Number.isFinite(Date.parse(r.createdAt)) &&
    (r.mode !== "relative" ||
      (Number.isFinite(r.percent) &&
        Math.abs(r.percent) <= 100 &&
        r.baseline?.features?.value > 0 &&
        typeof r.baseline.label === "string")) &&
    (r.mode !== "legacy" ||
      (Number.isFinite(r.legacy) && r.legacy >= 1 && r.legacy <= 10)) &&
    (!r.photo ||
      (typeof r.photo === "string" &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.photo)))
  );
}
