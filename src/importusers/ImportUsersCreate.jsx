import { useState } from "react";
import {
  SimpleForm,
  FileInput,
  FileField,
  Button,
  SaveButton,
  useRedirect,
  useGetIdentity,
} from "react-admin";
import {
  CircularProgress,
  CssBaseline,
  FormControlLabel,
  FormGroup,
  Grid,
  Paper,
  Switch,
  Typography,
} from "@mui/material";
import awsmobile from "../aws-export";
import { getApiHeaders } from "../utils/apiHeaders";
import Papa from "papaparse";
import { UserImportListWidget } from "./UserImportListWidget";

const apiUrl = awsmobile.aws_backend_api_url;

const importUserMaxAmount = 100000;

export const ImportUsersCreate = () => {
  const [userData, setUserData] = useState([]);
  const [jobId, setJobId] = useState('');
  const [importState, setImportState] = useState("init");
  const [checked, setChecked] = useState(true);
  const redirect = useRedirect();
  const { data: adminProfile } = useGetIdentity();

  const handleClick = () => redirect("/importusers");

  const parseCSVToUserData = (file) => {
    setImportState("init");

    if (file && file.csvFile) {
      setImportState("parsing");

      let count = 0;
      let validCount = 0;
      Papa.parse(file.csvFile.rawFile, {
        header: true,
        skipEmptyLines: true,
        worker: true, // Don't bog down the main thread if its a big file
        preview: importUserMaxAmount,
        step: function (result) {
          const phoneRegex =
            /^\+?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/im;
          const emailRegex = /^\b[A-Z0-9._+%-]+@[A-Z0-9.-]+\.[A-Z]{2,4}\b$/i;

          if (result.data.length === 0) {
            console.log("empty row");
            return;
          }

          count++;

          if (result.data.email && result.data.email.length > 0) {
            result.data.email = result.data.email.trim().toLowerCase();
          }

          // email and group are required
          if (
            result.data.email &&
            result.data.group &&
            result.first_name &&
            result.last_name
          ) {
            result.data.email.match(emailRegex)
              ? console.log("valid email")
              : console.log("invalid email");
            validCount++;
            console.log("valid row");
          }

          if (result.data.phone_number) {
            let phone_number = result.data.phone_number.trim();
            if (phone_number.length > 0 && phone_number[0] === "+") {
              phone_number = phone_number
                .substring(1)
                .replace(/[^0-9a-z]/gi, "");
              result.data.phone_number = "+" + phone_number;
            }
            result.data.phone_number.match(phoneRegex)
              ? console.log("valid phone")
              : console.log("invalid phone");
          }

          if (result.data.group && result.data.group.length > 0) {
            result.data.groups = result.data.group
              .split(",")
              .map(function (item) {
                return item.trim();
              });
          }

          if (result.data.first_name) {
            result.data.given_name = result.data.first_name.trim();
          }
          if (result.data.last_name) {
            result.data.family_name = result.data.last_name.trim();
          }
          if (result.data.middle_name) {
            result.data.middle_name = result.data.middle_name.trim();
          }
          if (result.data.name) {
            result.data.name = result.data.name.trim();
          }
          if (result.data.gender) {
            result.data.gender = result.data.gender.trim().toLowerCase();
          }
          if (result.data.picture) {
            result.data.picture = result.data.picture.trim();
          }
          if (result.data.profile) {
            result.data.profile = result.data.profile.trim();
          }
          if (result.data.birthdate) {
            result.data.birthdate = result.data.birthdate.trim();
          }
          if (result.data['alter-email']) {
            result.data['alter-email'] = result.data['alter-email'].toLowerCase().trim();
          }
          if (result.data['voice-number']) {
            result.data['voice-number'] = result.data['voice-number'].trim();
          }
          if (result.data.locale) {
            result.data.locale = result.data.locale.trim();
          }

          setUserData((userData) => [...userData, result.data]);
        },
        complete: function (results, file) {
          setImportState("csvValid");
          console.log("parsing complete read", count, "records.", results);
        },
      });
    }
  };

  const mailformatRegex = /^\b[A-Z0-9._+%-]+@[A-Z0-9.-]+\.[A-Z]{2,4}\b$/i;
  const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;

  const filterData = async (item) =>
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

  const submitUserData = async () => {

    const errorMsg = [];

    setImportState("importing");

    const url = `${apiUrl}/importusers`;

    const filteredData = userData.filter((item) => filterData(item));

    if (filteredData.length > 0) {

      try {
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify({
            userData: filteredData,
            admin: adminProfile?.email,
            notify: checked,
            totalusers: filteredData.length,
          }),
          headers: getApiHeaders(),
        });
        const json = await res.json();
        console.log('import done json', json);
        if (
          res.status !== 200 ||
          json.type === "exception" ||
          json.type === "Error"
        ) {
          console.log("errorMsg", errorMsg);
          setImportState("importDone");
        }
        else {
          setJobId(json.JobId)
        }
      } catch (error) {
        console.log("error", error);
      }

      setImportState("importDone");
      setUserData([]);
    }
    else {
      alert ("No valid data to import")
    }
  };

  const ImportButton = () => (
    <Button
      label="Import"
      onClick={submitUserData}
      variant="contained"
      color="primary"
      startIcon={null}
    />
  );

  return (
    <Paper
      elevation={1}
      style={{ margin: "20px", padding: "0px 20px 20px 20px", minHeight: "x" }}
    >
      <CssBaseline />
      <h1> Import Users</h1>
      {importState === "csvValid" && (
        <SimpleForm
          toolbar={
            <>
              <ImportButton />
              <Button
                label="Cancel"
                onClick={() => {
                  setUserData([]);
                  setImportState("init");
                }}
                color="primary"
                startIcon={<></>}
              />
            </>
          }
        >
          <h3> {importUserMaxAmount} users per import maximum</h3>
          <br />
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  checked={checked}
                  id="notify"
                  onChange={(e) => setChecked(e.target.checked)}
                />
              }
              label="Send an invitation email to user now"
            />
          </FormGroup>
          <br />
          <br />
          <UserImportListWidget data={userData} />
        </SimpleForm>
      )}
      {
        (importState === "importing" || importState === "parsing") && (
          <>
            <h3> {importUserMaxAmount} users per import maximum</h3>
            <CircularProgress sx={{ marginRight: 1 }} size={18} thickness={2} />
            <Typography variant="body2">
              {importState}...{" "}
            </Typography>
            <Typography variant="body2">
              Do not leave this page during import.
            </Typography>
          </>
        )
      }
      {
        importState === "importDone" && (
          <>
            <h3> {`Import Users task submitted - jobid : ${jobId}`} </h3>
            <Grid container>
              <Typography variant="body2" >
                User import job submitted. Please wait a few minutes and check the result.
              </Typography>
            </Grid>
            <br />
            <Button
              label="Okay"
              onClick={handleClick}
              variant="contained"
              color="primary"
              startIcon={<></>}
            />
          </>
        )
      }
      {
        importState === "init" && (
          <SimpleForm
            onSubmit={parseCSVToUserData}
            toolbar={<SaveButton label="Load Data" icon={<></>} />}
          >
            <h3> {importUserMaxAmount} users per import maximum</h3>
            <FileInput
              source="csvFile"
              label="Upload file (.csv)"
              accept=".csv"
            >
              <FileField source="src" title="title" />
            </FileInput>
            <br />
            <br />
            <div>
              <a
                href="https://downloads.apersona.com/aws-svcs/example.csv"
                download="example.csv"
                title="example import csv"
                target="_blank"
                rel="noreferrer"
              >
                Example Import CSV file
              </a>
            </div>
          </SimpleForm>
        )
      }
    </Paper >
  );
};
