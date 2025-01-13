import * as fs from "fs"
import * as OBC from "@thatopen/components"
import * as WEBIFC from "web-ifc"
import * as path from "path"

const components = new OBC.Components()
const loader = components.get(OBC.IfcLoader)
const file = fs.readFileSync("./HNS-CTL-ZZZ-MOD-ARQ-SPACES.ifc", "utf8");

const buffer = new TextEncoder().encode(file)
const model = await loader.load(buffer);

const propertiesManager = components.get(OBC.IfcPropertiesManager);
const { ownerHistoryHandle } = await propertiesManager.getOwnerHistory(model);

const indexer = components.get(OBC.IfcRelationsIndexer);
await indexer.process(model);

const spaces = await model.getAllPropertiesOfType(WEBIFC.IFCSPACE);
if (spaces) {
  for (const spaceID in spaces) {
    const definitions = indexer.getEntityRelations(
      model,
      Number(spaceID),
      "IsDefinedBy",
    );

    for (const definitionID of definitions) {
      const attrs = await model.getProperties(definitionID);
      if (!(attrs && attrs.Name?.value === "Dimensiones" && attrs.type === WEBIFC.IFCPROPERTYSET)) continue;

      for (const { value: propID } of attrs.HasProperties) {
        const attrs = await model.getProperties(propID);
        if (!(attrs && attrs.Name?.value === "Area" && attrs.NominalValue))
          continue;

        const { value: area } = attrs.NominalValue;

        const netFloorArea = new WEBIFC.IFC2X3.IfcQuantityArea(
          new WEBIFC.IFC2X3.IfcIdentifier("NetFloorArea"),
          null,
          null,
          new WEBIFC.IFC2X3.IfcAreaMeasure(area)
        )

        await propertiesManager.setData(model, netFloorArea);

        const qset = new WEBIFC.IFC2X3.IfcElementQuantity(
          new WEBIFC.IFC2X3.IfcGloballyUniqueId(OBC.UUID.create()),
          ownerHistoryHandle,
          new WEBIFC.IFC2X3.IfcLabel("Qto_SpaceBaseQuantities"),
          null,
          null,
          [new WEBIFC.Handle(netFloorArea.expressID)]
        )

        await propertiesManager.setData(model, qset);

        indexer.addEntitiesRelation(model, qset.expressID, { type: WEBIFC.IFCRELDEFINESBYPROPERTIES, inv: "DefinesOcurrence" }, Number(spaceID))
      }
    }


  }

  const modifiedBuffer = await propertiesManager.saveToIfc(
    model,
    buffer,
  );

  fs.writeFileSync(path.join(process.cwd(), "HNS-CTL-ZZZ-MOD-ARQ-SPACES_fixed.ifc"), modifiedBuffer)
}