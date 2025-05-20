import {
  useList,
  ListContextProvider,
  Datagrid,
  EmailField,
  TextField,
  ArrayField,
  ChipField,
  FunctionField,
  SingleFieldList,
  Pagination,
  // BooleanField,
} from "react-admin";

// import { GppBad } from '@mui/icons-material';
// import VerifiedIcon from '@mui/icons-material/Verified';
import { red } from "@mui/material/colors";
import { FormControlLabel, FormGroup, Switch, Typography } from "@mui/material";
import { useState } from "react";

export const UserImportListWidget = (props) => {
  // const [page, setPage] = useState(1);
  const listContext = useList({ data: props.data, perPage: 25, page: 1 });
  const mailformatRegex = /^\b[A-Z0-9._+%-]+@[A-Z0-9.-]+\.[A-Z]{2,4}\b$/i;
  const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
  let hasMiddleName = false;
  let hasName = false;
  let hasProfile = false;
  let hasPicture = false;
  let hasGender = false;
  let hasBirthdate = false;
  // let hasAddress = false;
  let hasAlterEmail = false;
  let hasVoiceNumber = false;
  let hasCity = false;

  const [checked, setChecked] = useState(true);
  // /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  const filteredData = props.data.filter((item) => {
    if (item.middle_name && item.middle_name.length > 0) hasMiddleName = true;
    if (item.name && item.name.length > 0) hasName = true;
    if (item.profile && item.profile.length > 0) hasProfile = true;
    if (item.picture && item.picture.length > 0) hasPicture = true;
    if (item.gender && item.gender.length > 0) hasGender = true;
    if (item.birthdate && item.birthdate.length > 0) hasBirthdate = true;
    // if (item.address && item.address.length > 0) hasAddress = true;
    if (item['alter-email'] && item['alter-email'].length > 0) hasAlterEmail = true;
    if (item['voice-number'] && item['voice-number'].length > 0) hasVoiceNumber = true;
    if (item.locale && item.locale.length > 0) hasCity = true;

    return !(
      item.email &&
      item.email !== "" &&
      item.email.match(mailformatRegex) &&
      item.given_name &&
      item.given_name !== "" &&
      item.family_name &&
      item.family_name !== "" &&
      (!item.phone_number ||
        item.phone_number === "" ||
        item.phone_number[0] === "+") &&
        (!item["alter-email"] ||
        item["alter-email"] === "" ||
        item["alter-email"].match(mailformatRegex)) &&
      (!item["voice-number"] ||
        item["voice-number"] === "" ||
        item["voice-number"][0] === "+") &&
      (!item.gender ||
        !item.gender.length ||
        ["male", "female", "other"].includes(item.gender)) &&
      (!item.birthdate ||
        !item.birthdate.length ||
        dateFormatRegex.test(item.birthdate))
    );
  });
  const filteredListContext = useList({
    data: filteredData,
    perPage: 25,
    page: 1,
  });

  return (
    <>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={checked}
              id="malformated-data-only"
              onChange={(e) => setChecked(e.target.checked)}
            />
          }
          label="Malformated Data lines only"
        />
      </FormGroup>
      <br />

      {((checked && filteredData?.length > 0) || !checked) && (
        <ListContextProvider
          value={checked ? filteredListContext : listContext}
        >
          <Datagrid
            bulkActionButtons={false}
            resource="users"
            size="medium"
            optimized
          >
            <FunctionField
              label="Email"
              render={(record) =>
                record.email &&
                record.email !== "" &&
                record.email.match(mailformatRegex) ? (
                  <EmailField record={{ name: record.email }} source="name" />
                ) : (
                  <Typography
                    variant="body2"
                    style={{ backgroundColor: "#f1f1f1" }}
                  >
                    {record.email} <br />{" "}
                    <div style={{ color: "#ff0000" }}> Invalid Email </div>
                  </Typography>
                )
              }
            />
            <FunctionField
              label="First Name"
              render={(record) =>
                record.given_name && record.given_name !== "" ? (
                  <TextField
                    record={{ name: record.given_name }}
                    source="name"
                  />
                ) : (
                  <TextField
                    record={{ name: "<Required>" }}
                    source="name"
                    sx={{ backgroundColor: "#f1f1f1", color: red[500] }}
                  />
                )
              }
            />
            <FunctionField
              label="Last Name"
              render={(record) =>
                record.family_name && record.family_name !== "" ? (
                  <TextField
                    record={{ name: record.family_name }}
                    source="name"
                  />
                ) : (
                  <TextField
                    record={{ name: "<Required>" }}
                    source="name"
                    sx={{ backgroundColor: "#f1f1f1", color: red[500] }}
                  />
                )
              }
            />
            <FunctionField
              label="Phone Number"
              render={(record) =>
                record.phone_number &&
                record.phone_number.trim() !== "" &&
                record.phone_number[0] !== "+" ? (
                  <Typography
                    variant="body2"
                    style={{ backgroundColor: "#f1f1f1" }}
                  >
                    {record.phone_number} <br />{" "}
                    <div style={{ color: "#ff0000" }}>
                      {" "}
                      Need start with "+"{" "}
                    </div>
                  </Typography>
                ) : (
                  <TextField
                    record={{ name: record.phone_number }}
                    source="name"
                  />
                )
              }
            />
            <FunctionField
              label="Group"
              render={(record) =>
                record.groups && record.groups.length > 0 ? (
                  <ArrayField label="Group" source="groups">
                    <SingleFieldList>
                      <FunctionField
                        render={(record) => (
                          <ChipField
                            record={{ name: record }}
                            source="name"
                            variant="outlined"
                          />
                        )}
                      />
                    </SingleFieldList>
                  </ArrayField>
                ) : (
                  <TextField
                    record={{ name: "<Required>" }}
                    source="name"
                    sx={{ color: red[500] }}
                  />
                )
              }
            />
            {hasAlterEmail && (
              <FunctionField
                label="Alternate Email"
                source="alter-email"
                render={(record) =>
                  !record["alter-email"] ||
                  record["alter-email"].length === 0 ||
                  record["alter-email"].match(mailformatRegex) ? (
                    <EmailField
                      record={{ name: record["alter-email"] }}
                      source="name"
                    />
                  ) : (
                    <Typography
                      variant="body2"
                      style={{ backgroundColor: "#f1f1f1" }}
                    >
                      {record["alt-email"]} <br />{" "}
                      <div style={{ color: "#ff0000" }}> Invalid Email </div>
                    </Typography>
                  )
                }
              />
            )}
            {hasVoiceNumber && (
              <FunctionField
                label="Voice Number"
                render={(record) =>
                  record["voice-number"] &&
                  record["voice-number"].trim() !== "" &&
                  record["voice-number"][0] !== "+" ? (
                    <Typography
                      variant="body2"
                      style={{ backgroundColor: "#f1f1f1" }}
                    >
                      {record["voice-number"]} <br />{" "}
                      <div style={{ color: "#ff0000" }}>
                        {" "}
                        Need start with "+"{" "}
                      </div>
                    </Typography>
                  ) : (
                    <TextField
                      record={{ name: record["voice-number"] }}
                      source="name"
                    />
                  )
                }
              />
            )}
            {hasCity && <TextField label="Location/Address" source="locale" />}
            {hasMiddleName && <TextField source="middle_name" />}
            {hasName && <TextField source="name" />}
            {hasProfile && <TextField source="profile" />}
            {hasPicture && <TextField source="picture" />}
            {hasGender && (
              <FunctionField
                label="Gender"
                render={(record) =>
                  !record.gender || !record.gender.length ? (
                    ""
                  ) : ["male", "female", "other"].includes(record.gender) ? (
                    <ChipField source="gender" variant="outlined" />
                  ) : (
                    <Typography
                      variant="body2"
                      style={{ backgroundColor: "#f1f1f1" }}
                    >
                      {record.gender} <br />
                      {""}
                      <div style={{ color: "#ff0000" }}>
                        {"<"}
                        Male/Female/Other{">"}
                      </div>
                    </Typography>
                  )
                }
              />
            )}
            {hasBirthdate && (
              <FunctionField
                label="Date of Birth"
                render={(record) =>
                  !record.birthdate ||
                  !record.birthdate.length ||
                  dateFormatRegex.test(record.birthdate) ? (
                    <TextField
                      record={{ name: record.birthdate }}
                      source="name"
                    />
                  ) : (
                    <Typography
                      variant="body2"
                      style={{ backgroundColor: "#f1f1f1" }}
                    >
                      {record.birthdate} <br />{" "}
                      <div style={{ color: "#ff0000" }}>
                        {" "}
                        Shall be in "YYYY-MM-DD" format{" "}
                      </div>
                    </Typography>
                  )
                }
              />
            )}
            {/* {hasAddress && <TextField source="address" />} */}
          </Datagrid>
          <Pagination />
        </ListContextProvider>
      )}
      {checked && filteredData.length === 0 && (
        <Typography variant="h6" color="inherit">
          No issue found
        </Typography>
      )}
    </>
  );
};
