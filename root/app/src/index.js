import express from 'express';
import fetch from 'fetch';
import dockerHubAPI from 'docker-hub-api';
import loadConfig from './config';

const config = loadConfig('/config/readmesync.json', ['dockerhub_username', 'dockerhub_password']);

const port = config.port || 80;

// Setup our HTTP webserver
const app = express();
app.get('*', (req, res) => {
  const { query } = req;

  if (!query.hasOwnProperty('github_repo') || !query.hasOwnProperty('dockerhub_repo')) {
    return res.status(400).send('Missing required fields in GET request');
  }

  if (!query.hasOwnProperty('github_branch')) {
    query.github_branch = 'master';
  }

  const dockerhub_username = query.dockerhub_repo.split('/')[0];
  const dockerhub_name = query.dockerhub_repo.split('/')[1];

  const update = async () => {
    // Check the repository exists
    const checkGithubRepo = await new Promise((resolve) => {
      fetch.fetchUrl(`https://github.com/${query.github_repo}`, (error) => {
        if (error) {
          return resolve(false);
        }
        return resolve(true);
      });
    });

    if (!checkGithubRepo) {
      return res.status(400).send(`GitHub repository: ${query.github_repo} not found`);
    }

    // Login to DockerHub
    await dockerHubAPI.login(config.dockerhub_username, config.dockerhub_password)
      .catch(() => {
        throw new Error('Unable to login to DockerHub, check credentials');
      });

    const getReadme = await new Promise((resolve, reject) => {
      fetch.fetchUrl(`https://raw.githubusercontent.com/${query.github_repo}/${query.github_branch}/README.md`, (error, meta, body) => {
        if (error) {
          return reject(`Unable to fetch README.md from GitHub repository: ${query.github_repo} branch: ${query.github_branch}`);
        }
        return resolve({ meta, body: body.toString() });
      });
    });

    await dockerHubAPI.setRepositoryDescription(dockerhub_username, dockerhub_name, {
      full: getReadme.body,
    });

    res.status(200).send('OK');
  };

  update()
    .catch((err) => {
      res.status(400).send(err.message);
    });
});

app.use((err, req, res, next) => {
  res.statusCode = 500;

  next();
});

const server = app.listen((port), () => {
  console.log(`Running readmesync. Listening on port ${port}.`);
});

// Shutdown gracefully
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      console.log(err);
      process.exit(1);
    }
    process.exit(0);
  });
});