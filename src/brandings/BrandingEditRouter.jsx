import { useRecordContext } from "react-admin";
import { BrandingEdit } from "./BrandingEdit";
import { AmfaBrandingEdit } from "./AmfaBrandingEdit";

/**
 * Routes to the correct edit form based on record's portal_type or id suffix.
 * - Login Service Portal (_amfa) → AmfaBrandingEdit
 * - End User Portal / Admin Portal → BrandingEdit (SP Portal form)
 */
export const BrandingEditRouter = (props) => {
  const record = useRecordContext();
  
  // Check the record id to determine which form to show
  const id = record?.id || '';
  if (id.endsWith('_amfa') || record?.portal_type === 'Login Service Portal') {
    return <AmfaBrandingEdit {...props} />;
  }
  return <BrandingEdit {...props} />;
};

export default BrandingEditRouter;
