import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::cli::Arguments" });

export const getUseSystemCA = b.fn({ returns: b.bool.optional });
export const getUseOpensslCA = b.fn({ returns: b.bool });
