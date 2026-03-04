/**
 * Build standard API request headers including Authorization and optional X-Tenant-Id.
 * 
 * Use this for any direct fetch() calls that bypass the dataProvider.
 * The dataProvider already includes these headers automatically.
 * 
 * @returns {Object} Headers object with Authorization, Content-Type, Accept, and optionally X-Tenant-Id
 */
export const getApiHeaders = () => {
  const headers = {
    Authorization: localStorage.getItem("token"),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  try {
    const stored = sessionStorage.getItem('selectedTenant');
    if (stored) {
      const { id } = JSON.parse(stored);
      if (id) headers["X-Tenant-Id"] = id;
    }
  } catch (e) {
    // ignore parse errors
  }
  return headers;
};

export default getApiHeaders;