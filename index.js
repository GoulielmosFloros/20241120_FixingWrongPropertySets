import * as fs from "fs"
import * as OBC from "@thatopen/components"
import * as WEBIFC from "web-ifc"
import * as path from "path"

// We create the main components entry point and get a reference to
// the IfcLoader to load the file in memory.
// The file is read as text (utf8)
const components = new OBC.Components()
const loader = components.get(OBC.IfcLoader)
const file = fs.readFileSync("./HNS-CTL-ZZZ-MOD-ARQ-SPACES.ifc", "utf8");

// As the file was loaded as text
// we encode it to get a typed array (Uint8Array)
// needed by the loaded
const buffer = new TextEncoder().encode(file)
const model = await loader.load(buffer);

// As we are going to be making data modifications in the model
// the PropertiesManager is needed.
// Many new entities require the IfcOwnerHistory, so we take a
// reference to it from the model loaded before.
const propertiesManager = components.get(OBC.IfcPropertiesManager);
const { ownerHistoryHandle } = await propertiesManager.getOwnerHistory(model);

// The indexer is needed as:
// 1. We must get the psets of the elements to process.
// 2. We must relate the new qsets with the elements.
const indexer = components.get(OBC.IfcRelationsIndexer);
await indexer.process(model);

// The psets we want to fix (for the model provided in the guide)
// are for the IfcSpaces. Therefore, we get all elements of that class.
const spaces = await model.getAllPropertiesOfType(WEBIFC.IFCSPACE);
if (spaces) {
  for (const spaceID in spaces) {
	  // We must get the list of Psets of the space, and
	  // for it we use the indexer with IsDefinedBy.
	  // That corresponds to the name of the inverse attribute
	  // that holds psets for any given entity.
    const definitions = indexer.getEntityRelations(
      model,
      Number(spaceID),
      "IsDefinedBy",
    );

    for (const definitionID of definitions) {
	    // From here you need to know your model.
	    // The psets we want to convert into qsets are named "Dimensiones".
	    // Based on that, we check the definition to have that name
	    // and also to be an IfcPropertySet.
      const attrs = await model.getProperties(definitionID);
      if (!(attrs && attrs.Name?.value === "Dimensiones" && attrs.type === WEBIFC.IFCPROPERTYSET)) continue;
			
      let qtoIDs = [];
			// HasProperties is the attribute name that holds all the
			// properties of an IfcPropertySet
      for (const { value: propID } of attrs.HasProperties) {
	      // Once again, here you need to know your model.
	      // There is one property in the pset called "Area" and we will
	      // use its value to create a quantity for it.
	      // PD: Make sure the NominalValue exists because is optional.
        const attrs = await model.getProperties(propID);
        if (!(attrs && attrs.Name?.value === "Area" && attrs.NominalValue)) {
          const { value: area } = attrs.NominalValue;
				
          // Inspecting the IFC documentation, the standardize qset to
          // hold IfcSpace quantifications is named "Qto_SpaceBaseQuantities".
          // One of the quantities is named "NetFloorArea" and is the one
          // used here to store the area from the property set.
          // Be sure you're using the correct entity (IfcQuantityArea) and
          // the correct data type (IfcAreaMeasure).
          // You can get both from the same IFC documentation.
          const netFloorArea = new WEBIFC.IFC2X3.IfcQuantityArea(
            new WEBIFC.IFC2X3.IfcLabel("NetFloorArea"),
            null,
            null,
            new WEBIFC.IFC2X3.IfcAreaMeasure(area)
          )

          // It's super important to use the PropertiesManager to inform
          // there is a new entity in the model.
          // You should do this right after a new entity has been created or
          // modified.
          await propertiesManager.setData(model, netFloorArea);

          qtoIDs.push(netFloorArea.expressID)

        } else if(!(attrs && attrs.Name?.value === "Perimetro" && attrs.NominalValue)) {
          const { value: perimeter } = attrs.NominalValue;

          const grossPerimeter = new WEBIFC.IFC2X3.IfcQuantityLength(
            new WEBIFC.IFC2X3.IfcLabel("GrossPerimeter"),
            null,
            null,
            new WEBIFC.IFC2X3.IfcLengthMeasure(perimeter)
          )

          await propertiesManager.setData(model, grossPerimeter);

          qtoIDs.push(grossPerimeter.expressID)

        } else {
          continue;
        }
      }

      // The NetFloorArea & NetPerimeter is going to be the only quantification in the set.
      // Being that said, the set must be createad.
      // Qsets in IFC are named IfcElementQuantity
      const qset = new WEBIFC.IFC2X3.IfcElementQuantity(
        new WEBIFC.IFC2X3.IfcGloballyUniqueId(OBC.UUID.create()),
        ownerHistoryHandle,
        new WEBIFC.IFC2X3.IfcLabel("Qto_SpaceBaseQuantities"),
        null,
        null,
        qtoIDs.map(id => new WEBIFC.Handle(id)) // Make sure to add here all the quantities
      )

      // Do not forget about informing the new entity added
      await propertiesManager.setData(model, qset);
      
      // The indexer must be used in order to relate the new qset with the space.
      // For it, we use the IfcRelDefinesByProperties relationship with the
      // DefinesOcurrence inverse attribute.
      indexer.addEntitiesRelation(
        model, 
        qset.expressID, 
        { type: WEBIFC.IFCRELDEFINESBYPROPERTIES, inv: "DefinesOcurrence" }, 
        Number(spaceID)
      )
    }

  }

	// Finally, use the PropertiesManager to save the changes back to the
	// original file.
  const modifiedBuffer = await propertiesManager.saveToIfc(
    model,
    buffer,
  );
	
	// And write a the new IFC file with the modifications back to the same folder
	// as the initial file.
  fs.writeFileSync(path.join(process.cwd(), "HNS-CTL-ZZZ-MOD-ARQ-SPACES_fixed.ifc"), modifiedBuffer)
}