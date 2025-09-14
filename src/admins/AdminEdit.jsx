import { AccountCircle } from "@mui/icons-material";
import {
  Avatar,
  Container,
  Grid,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
} from "@mui/material";

import * as React from "react";
import {
  useGetList,
  Edit,
  TextInput,
  AutocompleteArrayInput,
  FunctionField,
  Form,
  SaveButton,
  DeleteButton,
  TopToolbar,
  ListButton,
  TextField,
  BooleanInput,
  DateInput,
  AutocompleteInput,
} from "react-admin";

import { isIDN, validatePhoneNumber } from "../utils/validation";

export const AdminEdit = () => {
  const { data } = useGetList("groups", {
    pagination: { page: 1, perPage: 60 },
    sort: { field: "createdAt", order: "DESC" },
  });

  const formValidation = (values) => {
    const errors = {};

    if (isIDN()(values["phone_number"])) {
      errors["phone_number"] = isIDN()(values["phone_number"]);
    }

    if (isIDN()(values["voice-number"])) {
      errors["voice-number"] = isIDN()(values["voice-number"]);
    }

    if (values["alter-email"]) {
      if (
        values["alter-email"].toLowerCase().trim() ===
        values["email"].toLowerCase().trim()
      ) {
        errors["alter-email"] =
          "Alt email can not be the same as Primary email address";
      }
    }

    return errors;
  };

  const EditActions = () => (
    <TopToolbar>
      <DeleteButton
        confirmTitle="Are you sure you want to delete this user?"
        confirmContent=""
      />
      <ListButton />
    </TopToolbar>
  );

  const groupChoices = data
    ? data.map((item) => ({ id: item.id, name: item.group }))
    : [];

  return (
    <>
      <Edit
        mutationMode="pessimistic"
        redirect="show"
        actions={<EditActions />}
      >
        <Container style={{ padding: "15px" }}>
          <div
            style={{
              margin: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <FunctionField
              render={(record) => (
                <h1>{`Update ${
                  record.given_name
                    ? `- ${record.given_name.toUpperCase()}`
                    : "Profile"
                }`}</h1>
              )}
            />
            <FunctionField
              render={(record) => (
                record.license === false &&
                <h2><span style={{ color: "red" }}>User not licensed</span></h2>
              )}
            />
            <Form
              mode="onBlur"
              reValidateMode="onBlur"
              validate={formValidation}
            >
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={6} lg={5}>
                  <List>
                    <ListItem>
                      <ListItemAvatar>
                        <Avatar>
                          <AccountCircle />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary="EMAIL : "
                        secondary={
                          <>
                            <TextField
                              label={null}
                              onClick={() => {}}
                              source="email"
                              sx={{ color: "#1A76D2" }}
                            />
                          </>
                        }
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid item xs={0} sm={6} md={6} lg={7} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="First Name"
                    source="given_name"
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="Last Name"
                    source="family_name"
                    required
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    label="SMS Phone Number"
                    fullWidth
                    source="phone_number"
                    validate={validatePhoneNumber}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    label="Voice Number"
                    fullWidth
                    source="voice-number"
                    validate={validatePhoneNumber}
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    fullWidth
                    type="email"
                    label="Alternate Email"
                    source="alter-email"
                    parse={(v) => (v ? v.toLowerCase() : "")}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="Location/Address"
                    source="locale"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <AutocompleteArrayInput
                    label="User Groups"
                    source="groups"
                    choices={groupChoices}
                    fullWidth
                    isRequired={true}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <FunctionField
                    render={(record) => (
                      <BooleanInput
                        label="Mobile Token"
                        source="hasMobileToken"
                        fullWidth
                        disabled={!record.hasMobileToken}
                        helperText={
                          record.hasMobileToken ? (
                            <span style={{ color: "red" }}>
                              turn this off will remove mobile token
                            </span>
                          ) : (
                            "no mobile token setup"
                          )
                        }
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={12} md={12} lg={12}>
                  <Typography color="text.secondary"> Extra Info</Typography>
                </Grid>
                <Grid item xs={3} sm={3} md={2} lg={1}>
                  <Typography>SUB:</Typography>
                </Grid>
                <Grid item xs={9} sm={9} md={10} lg={11}>
                  <TextField
                    label={null}
                    onClick={() => {}}
                    source="sub"
                    sx={{ color: "#1A76D2" }}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="name" />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    source="middle_name"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="profile" />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="picture" />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <AutocompleteInput
                    source="gender"
                    choices={[
                      { id: "male", name: "male" },
                      { id: "female", name: "female" },
                      { id: "other", name: "other" },
                    ]}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <DateInput
                    label="Date of Birth"
                    fullWidth
                    source="birthdate"
                    allowempty="true"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
              </Grid>
              <Grid container justify="flex-end">
                <Grid item xs={5} sm={5} md={5} lg={5}>
                  <SaveButton label="Update" />
                </Grid>
              </Grid>
            </Form>
          </div>
        </Container>
      </Edit>
    </>
  );
};
